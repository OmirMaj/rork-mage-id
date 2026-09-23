import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { punchListTypeOf, contractTermsAfterLoad, contractTermsSyncColumns } from '@/types';
import { isFinancialsBlinded } from '@/utils/roleBlinding';
import { registerPreSignOutFlush } from '@/utils/preSignOutFlush';
import type { Project, ProjectType, AppSettings, PaymentSplit, CompanyBranding, ProjectCollaborator, ChangeOrder, COAuditEntry, Invoice, DailyFieldReport, DFRPhoto, Subcontractor, PunchItem, ProjectPhoto, PriceAlert, Contact, CommunicationEvent, RFI, Submittal, SubmittalReviewCycle, Equipment, EquipmentUtilizationEntry, PDFNamingSettings, Warranty, WarrantyClaim, PortalMessage, Commitment, PrequalPacket, PlanSheet, DrawingPin, PlanCalibration, PlanMarkup, PlanZone, PlanReview, Permit, SavedAIAPayApp, SubPortalLink, Lead, LeadStage, LeadTouch, BidPackage, BidPackageBid, BidPackageStatus, BuyoutBidStatus, OACMeeting, CertificateOfInsurance, PermitRoadmap, SendableItemKind, PortalState, FieldTicket, FieldTicketPhoto, DelayEvent, DelayEvidenceRef, DelayNotice, TaskStatus, PunchListType, ScheduleTask, InvoicePayment } from '@/types';
import { sealedFieldTicketViolations } from '@/utils/fieldTicketCore';
import { foldPlanSheets } from '@/utils/planSheetBatchCore';
import { punchItemsFollowingSubRename, ownsProjectFor } from '@/utils/subPortalSnapshot';
import { dayOrInstantDate, todayCalendarDay } from '@/utils/calendarDate';
import { projectTypeForLead, targetBudgetSeedForLead } from '@/utils/widgetLeadCore';
import { withSourcePhotoUris } from '@/utils/punchSourcePhoto';
import { useAuth } from '@/contexts/AuthContext';
import { useMageReachability, MAGE_REACHABILITY_QUERY_KEY } from '@/hooks/useMageReachability';
import { useFieldDayPackWarmer } from '@/hooks/useFieldDayPack';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite, supabaseWriteDetailed, supabaseRpcDetailed, bearerStillLive, getOfflineQueue, getOwnOfflineQueue, addToOfflineQueue, onQueueChanged, onQueueFlushed, onQueueDropped, onProjectDeleteRefused, currentSessionUserId, discardQueuedWrites, type WriteOutcome } from '@/utils/offlineQueue';
import { writePortalMessageOrdered, isPortalLockRefusal, portalRefusalCopy } from '@/utils/portalMessageWrite';
import { mergeInvoiceUpdate, invoiceUpdatePayload, invoiceInsertStillQueued, insertStillQueued, writeBehindQueuedInsert, sharedDraftIssuePatch } from '@/utils/invoiceWrites';
import { freezeForPortal, MAX_PORTAL_SNAPSHOT_BYTES } from '@/utils/portalFreeze';
import { invoiceOutstanding } from '@/utils/invoiceBilling';
import { leveledBuyoutSavings, uncoveredScopeOf } from '@/utils/projectFinancials';
import { licenceExpiryColumnValue, licenceStateColumnValue } from '@/utils/bidDocumentIdentity';
import { paymentTermsAfterLoad, pendingWithInFlight, termsColumnsForWrite, termsWritesPending } from '@/utils/paymentTerms';
import {
  applyHeldSettings, firstProfileReadTimeoutMs, heldSettingsPatch, mergeHeldPatches, sameSettings,
  owedSettingsRereadReady, settingsAfterRead, settingsHoldsBoot, settingsReadFallback, settingsRowWritePending,
  settingsRowWithUnsaved,
} from '@/utils/settingsLoadGuard';
import {
  acceptedRolesByProject, aiaRowToSaved, claimProjectForUser, classifyProjectForSync, coerceRate, financialPickAfterLoad,
  financialsLoadedFor, keepPendingPinFields, legacyMoneyPresent, mergeLocalOnly, myRoleAfterLoad, pendingIdsByTable, pendingIdsForTable,
  pendingPinIdsInQueue, pinOverlayIds,
  queryKeysForFlushedTables, savedToAiaRow, stripPortalCredentials,
  subCoiExpiryAcross, vanishedPendingIds, coiSaveStampsVerified,
  changeOrderTaxColumns, changeOrderTaxFromRow, chunkForAppend, dailyReportColumns, deleteProjectRefusal,
  invoiceBillToColumns, invoiceBillToFromRow, mergeServerKeepingPending, newAuditEntries, portalWriteRefusal,
  portalLiteOutcomeSettles, portalLiteSignature,
  coAuditPendingFromStore, coIdsWrittenDuringRead, overlayPendingAudit, portalDirtyProjectIds, portalDirtyProjects,
  portalMessageAllowed, notePortalListRead, portalListsFromServer, EMPTY_PORTAL_SERVER_READS, beginPortalReadEpoch, deviceRowsWrittenDuringRead,
  optimisticPaymentAppend, revertOptimisticPayment, pendingPaymentFromRow, portalArrivalProjectIds, portalContentFingerprint, portalSideListFresh, portalSendHeldForNumber, rpcOnlyLedgerIds, unsavedProjectIdsIn,
  stripDroppedPayment, droppedAppendEntryId, retriedAppendEntry, coAuditDropsForDiscard, ledgerLineAsQueueEntry,
  absorbedScheduleMeta, bearerTokenForRead, unsavedProjectPinsIn, overlayUnsavedRow, projectsReloadOwedAfterLoad, childProjectMap, combinePunchPending, countQueuedEntriesForProject, emptyReadAuthoritative, idsWrittenDuringRead, listsHoldRevoked,
  planProDocEdit, revocationConfirmed, serverStampAdoptable, noLongerHaveAccessReason, pendingDeleteIdsForTable, planWritesQueued,
  punchServerOwnedFromRow, queuedEntryRevokedProject, revokedCachedProjectIds, rowPatch, RFI_FIELD_COLUMNS,
  SUBMITTAL_FIELD_COLUMNS, RFI_GUARDED_COLUMNS, SUBMITTAL_GUARDED_COLUMNS, submittalIntakeColumns, submittalIntakeFromRow, unionServerFirst, PLAN_SYNC_TABLES,
  mintedShareToken, withServerShareToken, classifyCoAuditError, coAuditRefusalIsFinal, submittalCycleQueueHold, closeCycleHoldReason,
  alreadyClosedCycleReason, withMarkedApproved, planSheetsAfterDelete, fieldSeatCreatesDraft,
  // Wave 5 (w5-join-core)
  ownerClientPortalForWrite, localOnlyOwnedProjectIds, localOnlyProjectInsertRow, localOnlyProjectLineId, LOCAL_ONLY_PROJECT_REASON, withServerConfirmed,
  subcontractorExtrasFromRow, subcontractorExtraColumns, photoGeoFromRow, photoGeoColumns, prequalReviewRow,
  deleteProjectSafetyRefusal, localSafetyIncidentCount, SAFETY_CHECK_OFFLINE_REASON, DELETE_SAFETY_ACTION,
  type PrequalReviewPatch,
} from '@/utils/projectContextPure';
import { rememberServerChangeOrderNumbers } from '@/hooks/useServerChangeOrderNumber';

// #30 · The RFI / submittal reply-link token (projectContextPure.mintedShareToken):
// expo-crypto's CSPRNG — never utils/generateId, which falls back to
// Math.random on Hermes. The token is the bearer credential for
// get_rfi_by_token / submit_pro_response. undefined = the mint failed; the
// insert then omits share_token and the column default mints it.
const mintShareToken = (): string | undefined => mintedShareToken(() => Crypto.randomUUID());
import type { UnsavedProjectPins, CollaboratorRowLike, PortalFedList, PortalSideList, PortalServerReads } from '@/utils/projectContextPure';
import { generateUUID } from '@/utils/generateId';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { buildCostDatabase } from '@/utils/costDatabase';
import { estimateGroundingProps } from '@/utils/activationSignals';
import type { Delivery, DeliveryReceipt } from '@/utils/deliverySchedule';
import type { BuildingAccessRules, AccessReservation } from '@/utils/buildingAccess';
import { geocodeProjectLocation, shouldGeocode } from '@/utils/geocodeProject';
import { snapshotPatch } from '@/utils/estimateCommit';
import type { UserRole } from '@/utils/onboardingProfile';
import { fireGradingEvent } from '@/utils/brain/gradingBus';
// As-built capture on the DFR path — the pace book's intake valve.
import { stampActuals, todayScheduleDay } from '@/utils/pace/stampActuals';
import {
  applyCoScheduleReflow,
  buildUnanchoredCoAuditEntry,
  hasUnanchoredMarker,
  isCoScheduleReflowApplied,
  buildDeferredCoAuditEntry,
  normalizeImpactDays,
} from '@/utils/coScheduleReflowCore';
import { appendAuditToAsyncStorage } from '@/utils/scheduleAudit';
import {
  absorbServerScheduleTasks, applyFieldTaskPatches, fieldTaskDiff, projectSyncSendsSchedule, scheduleWritePathForRole,
  sendFieldTaskPatches, stampFieldEdits, mergeWrittenStamps,
} from '@/utils/fieldScheduleUpdate';
import {
  foldServerSchedule, newProjectWriteLog, noteProjectWrite, ownerUpsertCarriesSchedule,
  parseServerConfirmedIds, pendingProjectIdsInQueue, planProjectsLoad, resetProjectWriteLog, serializeServerConfirmedIds,
  orderedProjectWriter, unconfirmedProjectSyncIds, withDeviceCopies,
} from '@/utils/projectsLoadGuard';
import { useProjectsFocusRefetch } from '@/hooks/useProjectsFocusRefetch';
import { withActiveBaselineId } from '@/utils/scheduleOps';
import { showAlert } from '@/utils/alert';
import { sendLocalNotification } from '@/utils/notifications';
import { isPortalOwner, syncPortalSnapshotLite, type PortalLiteSyncInput } from '@/utils/portalLiteSync';
import {
  buildPhotoStoragePath, contentTypeForExt, isDeviceLocalUri, looksLikeStoragePath, photoExtFromUri,
} from '@/utils/photoUploadCore';
import { queuePhotoUpload, countQueuedPhotoUploadsForProject, discardQueuedPhotoUploads } from '@/utils/photoUploadQueue';
import { deviceCopyForServerRow, type PriorDeviceCopy } from '@/utils/deviceLocalCopy';
import { unsavedWriteIds, readSyncFailuresOrThrow, ownFailures, onUnsavedDiscarded, onUnsavedRetried, ownUnsavedWrites, noteUnsavedWrites, recordSyncFailures, labelForWrite, acknowledgeSyncFailures, isRecordRetrying } from '@/utils/syncLedger';
import { resolvePhotoUrls, deleteProjectPhotoObject } from '@/utils/storage';
import {
  carryDeviceLocalPlanSheetUris, durablePlanSheetValue, localPlanSheetValue,
  planSheetRowUris, resolvePlanSheetUrls,
} from '@/utils/planSheetUrls';
import { warrantyStatus } from '@/utils/workflowPipelines';

// ─── Photo durability ────────────────────────────────────────────────────────
// Every image the app captures used to have its raw `file://` URI written
// straight into Postgres — `photos.uri`, `punch_items.photo_uri`,
// `daily_reports.photos[].uri`. A `file://` path is meaningless on any other
// device, after a reinstall, on web, and in the client portal, and the
// `project-photos` bucket had never received a single object as a result. For
// an app where photos are legal documentation, that is silent data loss.
//
// The two helpers below are the ONLY place a local image becomes durable, so
// every capture surface (daily report, project gallery, punch walk, cost x-ray,
// plan viewer, AI punch, photo triage) gets the same behavior:
//
//   1. the UI keeps rendering the LOCAL uri — instant, and works with no signal;
//   2. the DATABASE gets the deterministic storage path;
//   3. the bytes go on utils/photoUploadQueue.ts, which uploads them whenever
//      the network next allows and never drops them if it can't.
//
// Nothing here is awaited on the render path.

/**
 * Stage a device-local image for durable upload and return the path the
 * database should store. Returns null when there's nothing to do (no session,
 * no image, or the URI is already remote).
 */
function stagePhotoUpload(opts: {
  userId: string | null | undefined;
  projectId: string;
  /** Object key within the project folder — the record's id, so the path is deterministic. */
  recordId: string;
  localUri: string | undefined;
}): string | null {
  const { userId, projectId, recordId, localUri } = opts;
  if (!userId || !projectId || !recordId || !localUri) return null;
  if (!isDeviceLocalUri(localUri)) return null;
  const ext = photoExtFromUri(localUri);
  const storagePath = buildPhotoStoragePath(userId, projectId, recordId, ext);
  void queuePhotoUpload({
    photoId: recordId, userId, projectId, localUri, storagePath,
    contentType: contentTypeForExt(ext),
  });
  return storagePath;
}

/**
 * The value a photo column must be given. Never a `file://` — if we have no
 * durable path yet, an empty string is strictly better than a URI that is
 * guaranteed to be unopenable everywhere except the device that wrote it
 * (consumers such as portalSnapshot already filter empty photo URLs out).
 */
function durablePhotoValue(storagePath: string | undefined, currentUri: string | undefined): string {
  if (storagePath) return storagePath;
  if (currentUri && !isDeviceLocalUri(currentUri)) return currentUri;
  return '';
}

// ── punch-batch pure (begin) ────────────────────────────────────────────────
// Everything between these markers is plain TypeScript with no imports beyond
// `durablePhotoValue` and `punchListTypeOf`, because scripts/validate-punch-batch.ts
// lifts this block out of the file and EXECUTES it — the context itself cannot
// load under bun. Keep it that way: a hook or a new import in here turns the
// guard red, which is the point.
//
// WHY A BATCH AT ALL. Selecting 100 items and closing them used to run the
// single-item update 100 times, one per render: 100 full-collection
// AsyncStorage saves, 100 re-renders, and a crash (or the app being swiped
// away) at item 50 left half the selection changed. The batch computes the
// whole next array once, so there is ONE state update and ONE local save, and
// still one queued Supabase write per row — offline replay stays per-row.

/** A per-id patch is a function of the row, not a map: it cannot be confused
 *  with a shared patch at runtime, and it sees the current row. */
type PunchBatchUpdates = Partial<PunchItem> | ((item: PunchItem) => Partial<PunchItem>);

type PinColumn = 'plan_sheet_id' | 'pin_x' | 'pin_y';

/** Pin columns this edit TOOK AWAY. Only those go out as NULL: an edit from a
 *  copy that never had the pin keeps omitting them, so a stale phone cannot
 *  wipe a pin another device placed. `undefined` alone is dropped by JSON and
 *  the server keeps the pin (Remove pin came back on the next refetch). */
function pinColumnsClearedBy(before: PunchItem, after: PunchItem): PinColumn[] {
  const out: PinColumn[] = [];
  if (before.planSheetId != null && after.planSheetId == null) out.push('plan_sheet_id');
  if (before.pinX != null && after.pinX == null) out.push('pin_x');
  if (before.pinY != null && after.pinY == null) out.push('pin_y');
  return out;
}

/** Does this row's UPDATE touch the pin columns (values or NULLs)? Only those
 *  writes are tracked for the refetch overlay. */
function rowCarriesPin(pi: PunchItem, clears: readonly PinColumn[] = []): boolean {
  return pi.planSheetId !== undefined || pi.pinX !== undefined || pi.pinY !== undefined || clears.length > 0;
}

/** #46/#53/#140 · The PunchItem keys one edit TOUCHED: every key the patch
 *  names (own keys — an own `undefined` is a removal) plus every key whose
 *  value the merge (or `finish`, e.g. photo staging) actually changed. The
 *  UPDATE is built from these only, so an edit that never named status can
 *  never write status. */
function punchKeysTouched(before: PunchItem, patch: Partial<PunchItem>, after: PunchItem): (keyof PunchItem)[] {
  const keys = new Set<keyof PunchItem>();
  for (const k of Object.keys(patch) as (keyof PunchItem)[]) if (k !== 'id' && k !== 'updatedAt') keys.add(k);
  const all = new Set([...Object.keys(before), ...Object.keys(after)] as (keyof PunchItem)[]);
  for (const k of all) {
    if (k === 'id' || k === 'updatedAt' || keys.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) keys.add(k);
  }
  return [...keys];
}

function applyPunchBatchUpdate(
  items: PunchItem[],
  ids: readonly string[],
  updates: PunchBatchUpdates,
  now: string,
  finish: (item: PunchItem) => PunchItem = (item) => item,
): { next: PunchItem[]; changed: PunchItem[]; cleared: Record<string, PinColumn[]>; touched: Record<string, (keyof PunchItem)[]> } {
  const wanted = new Set(ids);
  if (wanted.size === 0) return { next: items, changed: [], cleared: {}, touched: {} };
  const changed: PunchItem[] = [];
  const cleared: Record<string, PinColumn[]> = {};
  const touched: Record<string, (keyof PunchItem)[]> = {};
  const next = items.map(pi => {
    if (!wanted.has(pi.id)) return pi;
    const patch = typeof updates === 'function' ? updates(pi) : updates;
    // `id` is pinned: a patch that carried one would otherwise re-key the row
    // locally while the queued write still targets the old id.
    const merged = finish({ ...pi, ...patch, id: pi.id, updatedAt: now });
    changed.push(merged);
    const gone = pinColumnsClearedBy(pi, merged);
    if (gone.length > 0) cleared[pi.id] = gone;
    touched[pi.id] = punchKeysTouched(pi, patch, merged);
    return merged;
  });
  // Nothing matched (every id already deleted elsewhere): hand back the SAME
  // array so the caller can skip the save and the re-render entirely.
  return changed.length === 0 ? { next: items, changed, cleared, touched } : { next, changed, cleared, touched };
}

function applyPunchBatchDelete(
  items: PunchItem[],
  ids: readonly string[],
): { next: PunchItem[]; removed: PunchItem[] } {
  const wanted = new Set(ids);
  if (wanted.size === 0) return { next: items, removed: [] };
  const removed: PunchItem[] = [];
  const next = items.filter(pi => {
    if (!wanted.has(pi.id)) return true;
    removed.push(pi);
    return false;
  });
  return removed.length === 0 ? { next: items, removed } : { next, removed };
}

/** The punch_items UPDATE payload — one builder for the single and the batch
 *  path so they cannot drift. `list_type` is always explicit: moving an item
 *  between the punch list and the crew list is an EDIT, and an update without
 *  it survives locally and silently reverts on the next refetch (putting a crew
 *  chore back on the client's portal). */
/** Columns each touched PunchItem key maps to in a SCOPED update (see
 *  punchItemToUpdateRow). status / closedAt / rejection are handled apart;
 *  subNote, createdByUserId and xray are never written from here. */
const PUNCH_SCOPED_UPDATE_COLUMNS: Partial<Record<keyof PunchItem, readonly string[]>> = {
  description: ['description'], location: ['location'],
  // The pair travels together: the name without its id (or the id without its
  // name) is how a stale id came back after a reassign.
  assignedSub: ['assigned_sub', 'assigned_sub_id'], assignedSubId: ['assigned_sub', 'assigned_sub_id'],
  dueDate: ['due_date'], priority: ['priority'],
  photoUri: ['photo_uri'], photoStoragePath: ['photo_uri'],
  planSheetId: ['plan_sheet_id'], pinX: ['pin_x'], pinY: ['pin_y'],
  photoLatitude: ['photo_latitude'], photoLongitude: ['photo_longitude'],
  photoLocationAccuracyMeters: ['photo_accuracy_meters'], photoLocationLabel: ['photo_location_label'],
  sourcePhotoId: ['source_photo_id'], closedAt: ['closed_at'],
};

function punchItemToUpdateRow(pi: PunchItem, now: string, clears: readonly PinColumn[] = [], scope?: readonly (keyof PunchItem)[]): Record<string, unknown> {
  const whole: Record<string, unknown> = {
    id: pi.id, description: pi.description, location: pi.location, assigned_sub: pi.assignedSub,
    // `?? null`, not the bare value: a cleared id (reassigned to a typed name,
    // or a stale id dropped on save) is `undefined`, which JSON leaves out —
    // the server kept the old sub's id and the next refetch brought it back.
    assigned_sub_id: pi.assignedSubId ?? null,
    due_date: pi.dueDate, priority: pi.priority, status: pi.status,
    photo_uri: durablePhotoValue(pi.photoStoragePath, pi.photoUri) || null,
    // Plan-pin anchor + captured GPS on update too (were omitted, and
    // assigned_sub_id was dropped on update — fixed here).
    // An explicit NULL only for a pin column THIS edit took away (Remove pin,
    // or Undo back to no spot); otherwise the bare value, which JSON drops
    // when undefined so a stale copy never wipes someone else's pin.
    plan_sheet_id: clears.includes('plan_sheet_id') ? null : pi.planSheetId,
    pin_x: clears.includes('pin_x') ? null : pi.pinX,
    pin_y: clears.includes('pin_y') ? null : pi.pinY,
    photo_latitude: pi.photoLatitude, photo_longitude: pi.photoLongitude,
    photo_accuracy_meters: pi.photoLocationAccuracyMeters,
    photo_location_label: pi.photoLocationLabel,
    list_type: punchListTypeOf(pi),
    // Only when set: the column is new (20260917180000) and a missing column
    // stalls the write in the queue, so records with no source photo — nearly
    // all of them — never name it. The id is set once at creation.
    ...(pi.sourcePhotoId ? { source_photo_id: pi.sourcePhotoId } : {}),
    rejection_note: pi.rejectionNote, closed_at: pi.closedAt, updated_at: now,
  };
  if (!scope) return whole;
  // #46/#53/#140 · SCOPED (every edit path passes the keys it touched —
  // applyPunchBatchUpdate's `touched`): `id`, the columns those keys map to,
  // `list_type` (always explicit, see above) and `updated_at`. The whole row
  // from a stale copy put a sub's "Mark fixed" back to Open — on a due-date
  // pick, a reassign, a bulk room assign, a sub rename, or an edit queued
  // offline that morning. status / closed_at go only with an edit that names
  // status (closed_at follows it, NULL on a reopen so the old stamp does not
  // linger); rejection_note / rejected_at only with a reject (the edit names
  // rejectedAt — CONTRACT 12); the sub's own note never (he owns it).
  const named = new Set(scope);
  const row: Record<string, unknown> = { id: pi.id };
  for (const key of named) {
    for (const col of PUNCH_SCOPED_UPDATE_COLUMNS[key] ?? []) if (col in whole) row[col] = whole[col];
  }
  if (named.has('status')) { row.status = pi.status; row.closed_at = pi.closedAt ?? null; }
  if (named.has('rejectedAt')) { row.rejection_note = pi.rejectionNote ?? null; row.rejected_at = pi.rejectedAt ?? null; }
  row.list_type = whole.list_type;
  row.updated_at = now;
  return row;
}

/** The only columns a pin-scoped write may touch: where the item is on the
 *  plan, and where the phone was when its photo was taken. */
const PIN_SCOPED_COLUMNS = {
  planSheetId: 'plan_sheet_id', pinX: 'pin_x', pinY: 'pin_y',
  photoLatitude: 'photo_latitude', photoLongitude: 'photo_longitude',
  photoLocationAccuracyMeters: 'photo_accuracy_meters', photoLocationLabel: 'photo_location_label',
} as const;
type PinScopedField = keyof typeof PIN_SCOPED_COLUMNS;
type PinScopedPatch = Partial<Pick<PunchItem, PinScopedField>>;

/** Keep only the pin/GPS keys the caller NAMED (own keys, undefined included —
 *  an own `undefined` is a removal). Anything else in the patch is dropped, so
 *  a pin gesture can never smuggle a status or a description onto the wire. */
function pinScopedPatchOf(patch: PinScopedPatch): PinScopedPatch {
  const out: PinScopedPatch = {};
  for (const key of Object.keys(PIN_SCOPED_COLUMNS) as PinScopedField[]) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) (out as Record<string, unknown>)[key] = patch[key];
  }
  return out;
}

/** The punch_items UPDATE for a pin gesture (Pin items, Undo, Move/Remove pin,
 *  the walk's late GPS stamp): `id`, the columns this patch names, and
 *  `updated_at` — nothing else. punchItemToUpdateRow sends the WHOLE row from
 *  this phone's copy, so a pin placed on a stale copy (63 of them queued in a
 *  basement) put back the status, sub and description the office had changed
 *  meanwhile. Same rule as invoiceUpdatePayload: only the keys the edit names.
 *  A named key with no value goes out as NULL — Remove pin must reach the
 *  server, and JSON drops `undefined`. */
function punchPinScopedRow(id: string, patch: PinScopedPatch, now: string): Record<string, unknown> {
  const row: Record<string, unknown> = { id };
  const scoped = pinScopedPatchOf(patch);
  for (const key of Object.keys(scoped) as PinScopedField[]) {
    const v = scoped[key];
    row[PIN_SCOPED_COLUMNS[key]] = v === undefined ? null : v;
  }
  row.updated_at = now;
  return row;
}

/** Does a pin-scoped patch touch the pin itself (not just the GPS stamp)?
 *  Only those writes are tracked for the refetch overlay. */
function pinScopedPatchCarriesPin(patch: PinScopedPatch): boolean {
  return ['planSheetId', 'pinX', 'pinY'].some(k => Object.prototype.hasOwnProperty.call(patch, k));
}
// ── punch-batch pure (end) ──────────────────────────────────────────────────

/**
 * The `daily_reports.photos` JSON column, sanitized for the server: durable
 * path in `uri`, and `localUri` stripped entirely — it describes one device's
 * filesystem and has no business being replicated to everyone else's.
 */
function dfrPhotoRows(photos: DFRPhoto[] | undefined): DFRPhoto[] {
  return (photos ?? []).map((p) => {
    const { localUri: _localUri, ...rest } = p;
    return { ...rest, uri: durablePhotoValue(p.storagePath, p.uri) };
  });
}

/**
 * Turn stored photo columns back into something renderable.
 *
 * `photos.uri` holds a bucket path, and `project-photos` is private, so it has
 * to be signed. We sign in ONE batched request per query and prefer this
 * device's own local copy whenever it still has one — that keeps the gallery
 * instant and keeps it working offline, and it means an expired signature can
 * never blank out a photo the user took themselves.
 */
async function buildPhotoUrlResolver(storedValues: (string | undefined)[]): Promise<(stored: string | undefined, localUri?: string) => { uri: string; storagePath?: string }> {
  const paths = storedValues.filter((v): v is string => looksLikeStoragePath(v));
  const signed = paths.length > 0 ? await resolvePhotoUrls(paths) : new Map<string, string>();
  return (stored, localUri) => {
    const storagePath = looksLikeStoragePath(stored) ? stored : undefined;
    if (localUri) return { uri: localUri, storagePath };
    if (storagePath) return { uri: signed.get(storagePath) ?? '', storagePath };
    // Legacy rows (and the handful of dev rows that still hold a `file://`)
    // pass through untouched — no migration, no behavior change for them.
    return { uri: stored ?? '', storagePath: undefined };
  };
}

// ─── Plan-sheet durability (audit DB-F11) ────────────────────────────────────
// `plan_sheets.image_uri` used to hold the PERMANENT PUBLIC url that
// convert-pdf-to-images returned from getPublicUrl() on the public `plan-sheets`
// bucket. Construction drawings were therefore readable forever by anyone who
// ever saw a link — no expiry, no revocation when a sheet was superseded or a
// project deleted.
//
// Same two-value split as the photo helpers above: the DATABASE and the local
// cache get the storage PATH, and the renderable url is signed on READ. Every
// existing consumer of `sheet.imageUri` (plan-viewer, area-takeoff,
// plan-intelligence, compare-drawings, the mobile schedule's LivingFloorPlan /
// PlanZoneEditor, planPrefetch, planShareToken, askYourPlans) keeps working
// unchanged because the signing happens here, at the single hydration point.

// `durablePlanSheetValue` is the write-side half and lives in
// utils/planSheetUrls.ts next to the resolvers, so a guard can execute it
// without loading this 5,000-line provider.

const PROJECTS_KEY = 'mageid_projects';
const SETTINGS_KEY = 'mageid_settings';
const ONBOARDING_KEY = 'mageid_onboarding_complete';
const USER_ROLE_KEY = 'mageid_user_role';
const LEADS_KEY = 'mageid_leads';
const BID_PACKAGES_KEY = 'mageid_bid_packages';
const BID_PACKAGE_BIDS_KEY = 'mageid_bid_package_bids';
const CHANGE_ORDERS_KEY = 'mageid_change_orders';
// #40 · Audit entries a CO edit still owes the server (co_append_audit), per
// account — durable so an offline edit survives the app being killed.
const CO_AUDIT_PENDING_KEY = 'mageid_co_audit_pending';
const INVOICES_KEY = 'mageid_invoices';
const DAILY_REPORTS_KEY = 'mageid_daily_reports';
const FIELD_TICKETS_KEY = 'mageid_field_tickets';
const DELAY_EVENTS_KEY = 'mageid_delay_events';
const DELIVERIES_KEY = 'mageid_deliveries';
const BUILDING_ACCESS_KEY = 'mageid_building_access';
const ACCESS_RESERVATIONS_KEY = 'mageid_access_reservations';
const DELIVERY_RECEIPTS_KEY = 'mageid_delivery_receipts';
const SUBS_KEY = 'mageid_subcontractors';
const PUNCH_ITEMS_KEY = 'mageid_punch_items';
const PHOTOS_KEY = 'mageid_photos';
const PRICE_ALERTS_KEY = 'mageid_price_alerts';
const CONTACTS_KEY = 'mageid_contacts';
const COMM_EVENTS_KEY = 'mageid_comm_events';
const RFIS_KEY = 'mageid_rfis';
const SUBMITTALS_KEY = 'mageid_submittals';
const OAC_MEETINGS_KEY = 'mageid_oac_meetings';
const COIS_KEY = 'mageid_cois';
const EQUIPMENT_KEY = 'mageid_equipment';
const WARRANTIES_KEY = 'mageid_warranties';
const PORTAL_MESSAGES_KEY = 'mageid_portal_messages';
const COMMITMENTS_KEY = 'mageid_commitments';
const PREQUAL_KEY = 'mageid_prequal_packets';
const DRAWING_PINS_KEY = 'mageid_drawing_pins';
const PLAN_CALIBRATIONS_KEY = 'mageid_plan_calibrations';
const PLAN_SHEETS_KEY = 'mageid_plan_sheets';
const PLAN_MARKUPS_KEY = 'mageid_plan_markups';
const PLAN_ZONES_KEY = 'mageid_plan_zones';
const PLAN_REVIEWS_KEY = 'mageid_plan_reviews';
const PLAN_ROADMAPS_KEY = 'mageid_plan_roadmaps';
const PERMITS_KEY = 'mageid_permits';
const AIA_PAY_APPS_KEY = 'mageid_aia_pay_apps';
const SUB_PORTAL_LINKS_KEY = 'mageid_sub_portal_links';
// #7: the project ids the server is known to hold, stamped with the account
// (utils/projectsLoadGuard ownerUpsertCarriesSchedule has the why).
const SERVER_PROJECT_IDS_KEY = 'mageid_projects_server_ids';
// #1 fix round 2: the APPEND-ONLY "ever confirmed on the server" ids, per
// account (withServerConfirmed). Kept apart from SERVER_PROJECT_IDS_KEY, whose
// replace-on-load semantics the schedule / create decisions need. Swept with
// the account (mageid_ prefix).
const EVER_CONFIRMED_PROJECT_IDS_KEY = 'mageid_projects_ever_confirmed';
// The device's last-user marker, written by AuthContext (LAST_USER_ID_KEY
// there; offlineQueue repeats the literal too, for the same reason: neither
// module exports it). Read-only here.
const LAST_USER_MARKER_KEY = 'mageid_last_user_id';

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  licenseNumber: '',
  tagline: '',
  logoUri: undefined,
  signatureData: undefined,
};

const DEFAULT_SETTINGS: AppSettings = {
  location: 'United States',
  units: 'imperial',
  // MONEY-F3: 0 until the GC says otherwise. 7.5 % was applied to every
  // invoice, progress bill and CO preview of every account that never set a
  // rate — and to the ones that explicitly set 0 (see coerceRate).
  taxRate: 0,
  contingencyRate: 10,
  branding: DEFAULT_BRANDING,
};

// Review round 1 · A write whose row a concurrent read may predate: counts it
// on the wire and records when it settled, so a read that started before it
// keeps the device row (idsWrittenDuringRead). A queued write settles at once
// — the offline queue's own pending set protects it from then on.
type WriteTouches = Map<string, { inFlight: number; settledAt: number }>;
async function trackedWrite(
  touchesRef: { current: WriteTouches },
  table: string,
  operation: 'insert' | 'upsert' | 'update' | 'delete',
  data: Record<string, unknown>,
): Promise<WriteOutcome> {
  const id = typeof data.id === 'string' ? data.id : '';
  const touches = touchesRef.current;
  if (id) {
    const t = touches.get(id) ?? { inFlight: 0, settledAt: 0 };
    touches.set(id, { inFlight: t.inFlight + 1, settledAt: t.settledAt });
  }
  try {
    return await supabaseWriteDetailed(table, operation, data);
  } finally {
    if (id) {
      const t = touches.get(id) ?? { inFlight: 1, settledAt: 0 };
      touches.set(id, { inFlight: Math.max(0, t.inFlight - 1), settledAt: Date.now() });
    }
  }
}

// data-session critic · trackedWrite for a caller that needs supabaseWrite's
// own result: the row counts as on the wire until `send` settles, so a list
// re-read that started before it keeps the device row instead of dropping a
// just-created one (INSERT not yet committed) or reverting a just-made edit —
// which, for a punch item, the next whole-row update then wrote back.
async function touchedWrite<T>(touchesRef: { current: WriteTouches }, id: string, send: () => Promise<T>): Promise<T> {
  if (!id) return send();
  const touches = touchesRef.current;
  const t = touches.get(id) ?? { inFlight: 0, settledAt: 0 };
  touches.set(id, { inFlight: t.inFlight + 1, settledAt: t.settledAt });
  try {
    return await send();
  } finally {
    const after = touches.get(id) ?? { inFlight: 1, settledAt: 0 };
    touches.set(id, { inFlight: Math.max(0, after.inFlight - 1), settledAt: Date.now() });
  }
}

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * #23 · A save mutation whose every LOCAL write first tells the provider which
 * projects it touched (markPortalDirty). These writes make the provider
 * republish a portal; the only reads that do are the server reads of another
 * member's shared records (#17, wave 4 — see the publish readiness effect).
 * Everything that persists a portal-fed
 * list goes through one of these, so the mark cannot be forgotten at a call
 * site; a server-origin write (absorbServerSchedule) uses the raw mutation.
 */
function usePortalTrackedSave<T>(raw: { mutate: (next: T) => void }, note: (next: T) => void): { mutate: (next: T) => void } {
  const rawMutate = raw.mutate;
  return useMemo(() => ({ mutate: (next: T) => { note(next); rawMutate(next); } }), [rawMutate, note]);
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.log('[ProjectContext] Local save failed for', key, err);
  }
}

/** #8: project ids with a queued projects / project_financials write that
 *  THIS session owns (review round 1: another account's leftover entries —
 *  the queue survives a session expiry — must neither pull that account's
 *  rows into this one's list nor hold its re-read back). Marker first, queue
 *  second, as offlineQueue's own readers do. */
async function ownQueuedProjectIds(sessionUserId: string | null): Promise<Set<string>> {
  if (!sessionUserId) return new Set();
  let marker: string | null = null;
  try { marker = await AsyncStorage.getItem(LAST_USER_MARKER_KEY); } catch { marker = null; }
  return pendingProjectIdsInQueue(await getOfflineQueue(), { userId: sessionUserId, marker });
}

/** A projects load whose account signed out while it was out (#6). Thrown, not
 *  resolved as [] — see projectsQuery. Wave 4 #6: every child list's load
 *  throws it too (saveOwnedLocal), for the same reason. */
class StaleAccountLoadError extends Error {
  constructor() { super('list load for an account that has signed out'); this.name = 'StaleAccountLoadError'; }
}

/** Wave 4 #6 · The child lists' retry rule: a load whose account signed out is
 *  never retried (the account is gone — a retry would only re-read under the
 *  next account's bearer); anything else keeps the app-wide rule it replaces
 *  (app/_layout.tsx: no retry of a web "Failed to fetch", else 2 tries). The
 *  child loaders catch every other failure themselves and fall back to the
 *  device copy, so in practice this only ever sees StaleAccountLoadError. */
function retryUnlessStaleAccount(failureCount: number, error: unknown): boolean {
  if (error instanceof StaleAccountLoadError) return false;
  if (error instanceof TypeError && error.message === 'Failed to fetch') return false;
  return failureCount < 2;
}

/** #23: the provider-level portal publish waits this long after the last
 *  change, but never more than PORTAL_SYNC_MAX_WAIT_MS after the first. */
const PORTAL_SYNC_DEBOUNCE_MS = 2_500;
const PORTAL_SYNC_MAX_WAIT_MS = 10_000;

/** SYNC-F3: ids with a queued create/edit for `table` — what mergeLocalOnly keeps.
 *  Wave 4 #1: every child loader ALSO keeps utils/syncLedger.unsavedWriteIds —
 *  the rows whose write the server refused. Before, only queued ids were kept,
 *  so a refused write's record was the device's only copy and the next read
 *  (now every return to the foreground) deleted it. Only the sync sheet's
 *  Discard removes a ledger entry; Retry resends it. */
async function queuedIdsFor(table: string): Promise<Set<string>> {
  return pendingIdsForTable(await getOfflineQueue(), table);
}
// Integration round 2 — the ORDER of those two reads matters, and every
// loader reads the QUEUE FIRST, then the ledger. A write the flush drops moves
// queue → ledger, and utils/offlineQueue now writes its ledger line BEFORE the
// write-back takes it out of the queue. Queue-then-ledger therefore always
// sees it in one of the two; ledger-then-queue could read the ledger just
// before the line was written and the queue just after the entry left, and
// the merge deleted the device row.


/** Wave 4 review · Take out of `keep` the ids the ledger names ONLY for a
 *  refused rpc (rpcOnlyLedgerIds) — unless a write of that record is still
 *  queued (a queued append's optimistic row IS the device's only copy). A
 *  refused rpc stays in the ledger for Retry/Discard; it just stops shadowing
 *  the server row. Storage refused → keep everything (the safe side). */
async function dropRpcOnlyLedgerIds(keep: Set<string>, table: string, userId: string): Promise<void> {
  let own: ReturnType<typeof ownFailures>;
  try { own = ownFailures(await readSyncFailuresOrThrow(), userId); } catch { return; }
  const rpcOnly = rpcOnlyLedgerIds(own, table);
  if (rpcOnly.size === 0) return;
  const queued = await queuedIdsFor(table);
  for (const id of rpcOnly) if (!queued.has(id)) keep.delete(id);
}

/** Integration round 3 · The project ids this session has under Not saved:
 *  unsaved projects writes (less the rpc-only ones — a refused rpc stays on
 *  the sheet but does not shadow the server row, as dropRpcOnlyLedgerIds)
 *  and unsaved project_financials writes (keyed on project_id). Read AFTER
 *  the caller's queue read. Storage refused → empty (the queue decides). */
async function unsavedProjectPins(userId: string | null): Promise<UnsavedProjectPins> {
  const none = (): UnsavedProjectPins => ({ whole: new Set(), moneyOnly: new Set(), projectRows: new Map(), finRows: new Map(), deleted: new Set() });
  if (!userId) return none();
  try {
    const queued = await queuedIdsFor('projects');
    return unsavedProjectPinsIn(ownFailures(await readSyncFailuresOrThrow(), userId), queued);
  } catch (err) {
    console.log('[ProjectContext] Reading Not saved before the projects load failed:', err);
    return none();
  }
}

/** Integration round 3 · This session's unsaved writes of `table` in the
 *  queue-entry shape the settings guards read (settingsRowWritePending,
 *  termsWritesPending) — a refused settings save is kept on the phone the way
 *  a queued one is. Folded lines carry every column parked into them.
 *  Storage refused → []. */
async function unsavedAsQueueEntries(table: string): Promise<{ table: string; operation: string; data: Record<string, unknown>; queuedAt?: number }[]> {
  try {
    return (await ownUnsavedWrites())
      .filter((f) => f.table === table && !!f.row && !!f.operation)
      .map((f) => ({ table, operation: f.operation as string, data: f.row as Record<string, unknown>, queuedAt: f.queuedAt ?? f.at }));
  } catch {
    return [];
  }
}

/** #112: ids with a queued DELETE for `table` — what mergeLocalOnly leaves out. */
async function queuedDeletesFor(table: string): Promise<Set<string>> {
  return pendingDeleteIdsForTable(await getOfflineQueue(), table);
}

/** What addReviewCycle resolved to. `queued`: offline — the cycle rides the
 *  offline queue and the server's append-only guard numbers it on arrival. */
export type ReviewCycleResult =
  | { ok: true; cycleNumber: number; queued?: boolean }
  | { ok: false; reason: string };

/** A failed call that never reached the server (vs. one the server refused). */
function looksLikeNetworkFailure(message: string | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  return m.includes('network') || m.includes('failed to fetch') || m.includes('fetch failed')
    || m.includes('timed out') || m.includes('timeout') || m.includes('offline');
}

// ─── Per-bucket context objects ───────────────────────────────────────────────
// Each holds exactly the slice of useProjects() keys assigned to its bucket by
// docs/superpowers/audits/2026-05-18-h5-context-key-map.md.
// All default to null; the provider below fills every one before children render.

type CoreDataValue = {
  projects: Project[];
  settings: AppSettings;
  hasSeenOnboarding: boolean | null;
  /** Marketplace persona. `null` while the profile query is still hydrating
   *  on cold boot; `undefined`-as-stored-value means the user has not yet
   *  picked one (route them to /persona-select). */
  userRole: UserRole | null;
  isLoading: boolean;
  /** True once projects have hydrated from storage/network. Distinguishes
   *  "still loading" from "not found" for deep-linked detail screens. */
  projectsLoaded: boolean;
  /** True once THIS account's settings are in state (device copy or the
   *  profiles read). Before that `settings` is DEFAULT_SETTINGS: never ask a
   *  question it seems to leave open, and never write a merge onto it. */
  settingsLoaded: boolean;
  /** True while `settingsLoaded` is false because the profiles read FAILED
   *  (or timed out) and there is no device copy — not merely still loading.
   *  A profile-gated control says his profile could not be loaded, and offers
   *  retryRemoteReads, instead of "One second" for as long as the signal is
   *  gone. Always false once loaded. */
  settingsLoadFailed: boolean;
  /** RT-R1: MAGE could not be reached as this user on the last probe. Every
   *  loader in this file swallows a failed read and serves the local cache
   *  (30 `if (!error && data && data.length > 0)` fallthroughs), which is
   *  right for offline-first and means an empty array here is EITHER "you
   *  have nothing" OR "every read 401'd". A surface that makes an absolute
   *  claim about the user's own book — "No projects yet", "you haven't
   *  posted anything" — must gate that claim on this being false, or a GC
   *  who reinstalls sees his entire book of work reported as deleted. */
  sourceFailed: boolean;
  /** Re-run every read this provider owns, plus the probe that reported the
   *  failure. What a Retry button on a `sourceFailed` surface calls. */
  retryRemoteReads: () => void;
  /** CONTRACT 24 (wave 5, #150): the foreground re-read, on demand — the
   *  projects (unless a project write is still out: then it is owed and runs
   *  when that write reports), invoices, pay apps, profile, RFIs,
   *  submittals, punch, change orders, reports, photos, permits, warranties
   *  and prequal packets, each skipped while this device has that kind of
   *  write still out. What a pull-to-refresh awaits. */
  refreshAll: () => Promise<void>;
  /** Wave 5 (settings #3/#4): after "Reset this device" swept the device
   *  caches, drop the in-memory plan lists (sheets, pins, markups,
   *  calibrations, zones, reviews, permit roadmaps) — they are not
   *  react-query data, so the invalidations do not touch them and the next
   *  plan edit would have written them straight back — and re-read the plans
   *  from the server. */
  reloadLocalMirrors: () => Promise<void>;
  /** #23 round 2: every list a homeowner-portal publish is built from was
   *  read from the SERVER since the latest return to the foreground. A
   *  screen that publishes a portal snapshot itself (project-detail) waits
   *  for this — a list that is the cache's, or older than the last
   *  foreground, would pull what it lacks off the homeowner's portal (#44). */
  portalListsServerRead: boolean;
  /** #15 (integration round 1): the AIA pay-app list was read from the server
   *  in this foreground epoch too — the provider's own gate for handing the
   *  list to the lite writer (portalAiaFresh). A screen that publishes passes
   *  aiaPayApps only while this is true, and omits the key otherwise so the
   *  published pay-app section is carried (the overlay can only remove). */
  portalAiaListServerRead: boolean;
  /** #111/#130 (wave 4): true while a projects read is in flight — a screen
   *  that cannot find a job it was just sent to shows the loader, not
   *  "Project not found", until the read has answered. */
  projectsFetching: boolean;
  /** #4 (wave 4): resolves with how the job's create write ended. */
  addProject: (project: Project) => Promise<WriteOutcome>;
  updateProject: (id: string, updates: Partial<Project>) => void;
  /** Refused — with the reason, BEFORE anything on the phone changes — for a
   *  project he does not own (#92: the server would match 0 rows while the
   *  local cascade wiped his copy), and (wave 5 #61, CONTRACT 22) for a job
   *  with injury / near-miss records on the OSHA 300 log (`action:
   *  'mark_closed'` — offer Mark closed instead). Pass the job's incident
   *  count when the caller has it (project-detail reads useSafety()); without
   *  one the device's incidents and queue are counted, then the server is
   *  asked, and a job that cannot be checked (offline) is refused with
   *  SAFETY_CHECK_OFFLINE_REASON. Resolves once the local delete is done. */
  deleteProject: (id: string, opts?: { safetyIncidentCount?: number }) => Promise<DeleteProjectResult>;
  /** A job he is a TEAMMATE on, off this phone (project-hub's Leave, once the
   *  server confirmed it): the row, its child records and its queued writes —
   *  no server delete, and no "removed from a job" alert for a job he left
   *  himself. Refused, with why, for a job he owns (delete it instead). */
  /** `dropped` (#8/#128, wave 4): how many unsent writes and photos of the job were discarded. */
  forgetSharedProject: (id: string) => { ok: true; dropped?: Promise<number> } | { ok: false; reason: string };
  getProject: (id: string) => Project | null;
  updateSettings: (updates: Partial<AppSettings>) => void;
  /**
   * Save the GC's payment split and/or warranty months — the ONLY writer of
   * profiles.deposit_pct / progress_pct / final_pct / warranty_months. Each
   * group goes in its own profiles update carrying `id` plus those columns, so
   * a device holding an older settings object can never overwrite the answer
   * through the whole-row settings save (which never sends them). Returns
   * false, and writes nothing, when the input would fail the database CHECK.
   */
  savePaymentTerms: (input: { split?: PaymentSplit; warrantyMonths?: number }) => boolean;
  addCollaborator: (projectId: string, collab: ProjectCollaborator) => void;
  removeCollaborator: (projectId: string, collabId: string) => void;
  priceAlerts: PriceAlert[];
  addPriceAlert: (alert: PriceAlert) => void;
  updatePriceAlert: (id: string, updates: Partial<PriceAlert>) => void;
  deletePriceAlert: (id: string) => void;
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  updateContact: (id: string, updates: Partial<Contact>) => void;
  deleteContact: (id: string) => void;
  getContact: (id: string) => Contact | null;
  commEvents: CommunicationEvent[];
  addCommEvent: (event: CommunicationEvent) => void;
  getCommEventsForProject: (projectId: string) => CommunicationEvent[];
};

/** Where a record write landed. `synced`/`queued`/`failed` are
 *  supabaseWriteDetailed's answers; `local` = this device only because there
 *  is no signed-in account to sync as (the row is in AsyncStorage, nowhere else). */
export type RecordWriteOutcome = WriteOutcome | 'local';
/** The least-landed of several writes: one failed insert makes the batch failed. */
export function worstWriteOutcome(outcomes: RecordWriteOutcome[]): RecordWriteOutcome {
  if (outcomes.includes('failed')) return 'failed';
  if (outcomes.includes('queued')) return 'queued';
  if (outcomes.includes('local')) return 'local';
  return 'synced';
}

/** What deleteProject answers (wave 5, CONTRACT 22). `action: 'mark_closed'`
 *  = the job keeps safety records: offer Mark closed instead of Delete. */
export type DeleteProjectResult =
  | { ok: true }
  | { ok: false; reason: string; action?: typeof DELETE_SAFETY_ACTION };

type FinancialsDataValue = {
  changeOrders: ChangeOrder[];
  /** True once THIS account's change orders are in `changeOrders` (server
   *  read, or the device copy it falls back to). Before that an empty array
   *  means "not loaded yet", NOT "no such CO": a screen opened on a CO id must
   *  wait for this before it mounts an editor that seeds from the record, or
   *  it shows — and can save — a blank form over the real CO. */
  changeOrdersLoaded: boolean;
  /** Wave 5 (home #151): true once THIS account's invoices read has answered
   *  (server, or the device copy it falls back to). Before that an empty
   *  `invoices` means "not loaded yet", not "no invoices". */
  invoicesLoaded: boolean;
  /** Resolves to where the CO actually landed (see RecordWriteOutcome) — a
   *  "saved" message must say queued or failed when that is what happened.
   *  Local state and the device copy are updated synchronously either way. */
  addChangeOrder: (co: ChangeOrder) => Promise<RecordWriteOutcome>;
  addChangeOrders: (cos: ChangeOrder[]) => Promise<RecordWriteOutcome>;
  getChangeOrdersForProject: (projectId: string) => ChangeOrder[];
  addInvoice: (invoice: Invoice) => void;
  updateInvoice: (id: string, updates: Partial<Invoice>) => void;
  /** How this device's INSERT of invoice `id` ended (waiting for it if it is
   *  still out): 'synced' (on the server), 'queued' (offline — lands on the
   *  next flush), 'failed' (refused — not saved to the server). undefined when
   *  this session never inserted it (an invoice loaded from the server). */
  awaitInvoiceInsert: (id: string) => Promise<WriteOutcome | undefined>;
  /** #80/#35 (wave 4, CONTRACT 2): append ONE payment to invoice `invoiceId`
   *  through invoice_append_payment — on the server, under a row lock, by the
   *  entry's id (a queue replay is a no-op). Never the whole ledger: that
   *  erased a client's Pay-link payment from a stale phone. The device copy
   *  shows the payment at once. 'synced' = on the server (the list is then
   *  re-read, so the server's ledger and status replace the guess); 'queued'
   *  = offline, lands on the next flush (the device copy is kept until then);
   *  'failed' = refused, NOTHING recorded (the device copy is put back) — a
   *  caller must never report it as saved. */
  recordInvoicePayment: (invoiceId: string, entry: InvoicePayment) => Promise<WriteOutcome>;
  getInvoicesForProject: (projectId: string) => Invoice[];
  getTotalOutstandingBalance: () => number;
  invoices: Invoice[];
  commitments: Commitment[];
  addCommitment: (c: Commitment) => void;
  updateCommitment: (id: string, updates: Partial<Commitment>) => void;
  deleteCommitment: (id: string) => void;
  getCommitmentsForProject: (projectId: string) => Commitment[];
  prequalPackets: PrequalPacket[];
  upsertPrequalPacket: (packet: PrequalPacket) => void;
  /** #24 (wave 5): a REVIEW (approve / needs changes / reject / pipeline step)
   *  writes only the reviewer's columns — status, reviewer_notes, reviewed_at,
   *  reviewed_by, expires_at, auto_review_findings, updated_at — and merges
   *  them into the device copy. Never the whole packet: a copy loaded before
   *  the sub submitted put his old answers back over the ones he just sent.
   *  Invite, renewal and create stay on upsertPrequalPacket. */
  reviewPrequalPacket: (id: string, patch: PrequalReviewPatch) => void;
  deletePrequalPacket: (id: string) => void;
  getPrequalPacketForSub: (subId: string) => PrequalPacket | null;
  getPrequalPacketByToken: (token: string) => PrequalPacket | null;
  aiaPayApps: SavedAIAPayApp[];
  addAIAPayApp: (app: SavedAIAPayApp) => SavedAIAPayApp;
  deleteAIAPayApp: (id: string) => void;
  getAIAPayAppsForProject: (projectId: string) => SavedAIAPayApp[];
  // Delay register — the claim-defense spine. Sits with change orders rather
  // than the field tables because it is claim material (causation, dollar
  // reservations, the GC's own contractor_caused admissions) and its RLS
  // mirrors change_orders for exactly that reason.
  delayEvents: DelayEvent[];
  addDelayEvent: (event: DelayEvent) => DelayEvent;
  updateDelayEvent: (id: string, updates: Partial<DelayEvent>) => void;
  deliveries: Delivery[];
  addDelivery: (d: Delivery) => Delivery;
  updateDelivery: (id: string, updates: Partial<Delivery>) => void;
  deleteDelivery: (id: string) => void;
  // Building access — what the building requires and the slots booked from it.
  buildingAccessRules: BuildingAccessRules[];
  getBuildingAccess: (projectId: string) => BuildingAccessRules | null;
  setBuildingAccess: (rules: BuildingAccessRules) => void;
  /** What actually arrived. Pairs with `deliveries` (what was promised). */
  deliveryReceipts: DeliveryReceipt[];
  addDeliveryReceipt: (r: DeliveryReceipt) => DeliveryReceipt;
  getReceiptsForProject: (projectId: string) => DeliveryReceipt[];
  accessReservations: AccessReservation[];
  addReservation: (r: AccessReservation) => AccessReservation;
  updateReservation: (id: string, updates: Partial<AccessReservation>) => void;
  deleteReservation: (id: string) => void;
  deleteDelayEvent: (id: string) => void;
  getDelayEventsForProject: (projectId: string) => DelayEvent[];
};

type FieldDataValue = {
  dailyReports: DailyFieldReport[];
  /** True once THIS account's daily reports are in `dailyReports`. Same
   *  contract as `changeOrdersLoaded`: until then a report opened by id is
   *  "loading", never a blank, saveable form (a web refresh on
   *  /daily-report?reportId= used to save that blank form over the day). */
  dailyReportsLoaded: boolean;
  getDailyReportsForProject: (projectId: string) => DailyFieldReport[];
  // T&M / extra-work field tickets. `updateFieldTicket` REFUSES content edits
  // once a ticket is signed — see utils/fieldTicketCore.sealedFieldTicketViolations.
  fieldTickets: FieldTicket[];
  addFieldTicket: (ticket: FieldTicket) => void;
  updateFieldTicket: (id: string, updates: Partial<FieldTicket>) => boolean;
  getFieldTicketsForProject: (projectId: string) => FieldTicket[];
  punchItems: PunchItem[];
  addPunchItem: (item: PunchItem) => void;
  addPunchItems: (items: PunchItem[]) => void;
  updatePunchItem: (id: string, updates: Partial<PunchItem>) => void;
  /** Bulk edit: one state update, one local save, one queued write per row.
   *  `updates` is either one patch for every id or a function giving each row
   *  its own. Never loop `updatePunchItem` for a selection. */
  updatePunchItems: (ids: readonly string[], updates: PunchBatchUpdates) => void;
  /** A pin gesture on ONE item: its plan pin and/or photo GPS stamp, applied
   *  locally at once, and sent as ONLY those columns (+ updated_at) through the
   *  offline queue — never the whole row, so it cannot undo a status, sub or
   *  description another device changed. Other keys in `fields` are ignored. */
  updatePunchItemPin: (id: string, fields: Partial<Pick<PunchItem, 'planSheetId' | 'pinX' | 'pinY' | 'photoLatitude' | 'photoLongitude' | 'photoLocationAccuracyMeters' | 'photoLocationLabel'>>) => void;
  deletePunchItem: (id: string) => void;
  /** Bulk delete — same shape as updatePunchItems. */
  deletePunchItems: (ids: readonly string[]) => void;
  getPunchItemsForProject: (projectId: string) => PunchItem[];
  /** True once THIS account's punch items are in `punchItems` — same contract
   *  as `photosLoaded`. Pin items and the punch list's "On the plan" card make
   *  claims ("all pinned", "0 of 63") that are false against an empty list
   *  that simply has not hydrated yet. */
  punchItemsLoaded: boolean;
  projectPhotos: ProjectPhoto[];
  /** True once THIS account's photos are in `projectPhotos` — same contract
   *  as `dailyReportsLoaded`. The photo annotator seeds its markups once, at
   *  mount; opened by id before this it seeded [] (or a stale device copy)
   *  and Save wrote that over the photo's real markup everywhere. */
  photosLoaded: boolean;
  addProjectPhoto: (photo: ProjectPhoto) => void;
  updateProjectPhoto: (id: string, updates: Partial<ProjectPhoto>) => void;
  deleteProjectPhoto: (id: string) => void;
  getPhotosForProject: (projectId: string) => ProjectPhoto[];
  equipment: Equipment[];
  addEquipment: (equip: Omit<Equipment, 'id' | 'createdAt'>) => void;
  updateEquipment: (id: string, updates: Partial<Equipment>) => void;
  deleteEquipment: (id: string) => void;
  logUtilization: (entry: Omit<EquipmentUtilizationEntry, 'id'>) => void;
  getEquipmentForProject: (projectId: string) => Equipment[];
  getEquipmentCostForProject: (projectId: string) => number;
  planSheets: PlanSheet[];
  /** True once THIS account's plan sheets have had their first local AND
   *  server pass. "Pinned" is judged against the sheet list — before it lands,
   *  every pin reads as on a missing sheet, so "0 of 63 pinned" would be a
   *  guess shown as fact (and Pin items would queue items already pinned). */
  planSheetsLoaded: boolean;
  addPlanSheet: (sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>) => PlanSheet;
  /**
   * Add many sheets in ONE persist (a PDF import). Returns exactly the sheets
   * created — count those, never the input. `matchUnnumberedByPage` makes a
   * re-import of the same file supersede its earlier pages instead of doubling
   * them (utils/planSheetBatchCore.ts).
   */
  addPlanSheets: (
    sheets: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>[],
    opts?: { matchUnnumberedByPage?: boolean },
  ) => { created: PlanSheet[]; superseded: PlanSheet[] };
  updatePlanSheet: (id: string, updates: Partial<PlanSheet>) => void;
  /** #74 · Re-read sheets, pins, markups and calibrations from the server
   *  (no local re-paint). A no-op while any plan write is still queued. For
   *  the Plans screens' pull-to-refresh and focus. */
  refetchPlansFromServer: () => Promise<void>;
  deletePlanSheet: (id: string) => void;
  getPlanSheetsForProject: (projectId: string) => PlanSheet[];
  getPlanSheet: (id: string) => PlanSheet | undefined;
  drawingPins: DrawingPin[];
  addDrawingPin: (pin: Omit<DrawingPin, 'id' | 'createdAt' | 'updatedAt'>) => DrawingPin;
  updateDrawingPin: (id: string, updates: Partial<DrawingPin>) => void;
  deleteDrawingPin: (id: string) => void;
  getPinsForPlan: (planSheetId: string) => DrawingPin[];
  getPinsForPhoto: (photoId: string) => DrawingPin[];
  planZones: PlanZone[];
  addPlanZone: (zone: Omit<PlanZone, 'id' | 'createdAt' | 'updatedAt'>) => PlanZone;
  updatePlanZone: (id: string, patch: Partial<PlanZone>) => void;
  deletePlanZone: (id: string) => void;
  getPlanZonesForPlan: (planSheetId: string) => PlanZone[];
  getPlanZonesForProject: (projectId: string) => PlanZone[];
  planReviews: PlanReview[];
  getPlanReviewForSheet: (planSheetId: string) => PlanReview | null;
  savePlanReview: (review: PlanReview) => void;
  updatePlanReview: (id: string, patch: Partial<PlanReview>) => void;
  deletePlanReview: (id: string) => void;
  planMarkups: PlanMarkup[];
  addPlanMarkup: (markup: Omit<PlanMarkup, 'id' | 'createdAt'>) => PlanMarkup;
  deletePlanMarkup: (id: string) => void;
  getMarkupsForPlan: (planSheetId: string) => PlanMarkup[];
  planCalibrations: PlanCalibration[];
  upsertPlanCalibration: (cal: Omit<PlanCalibration, 'id' | 'createdAt'>) => PlanCalibration;
  getCalibrationForPlan: (planSheetId: string) => PlanCalibration | undefined;
  permitRoadmaps: PermitRoadmap[];
  getPermitRoadmapForProject: (projectId: string) => PermitRoadmap | undefined;
  savePermitRoadmap: (roadmap: PermitRoadmap) => void;
  updatePermitRoadmap: (id: string, patch: Partial<PermitRoadmap>) => void;
  deletePermitRoadmap: (id: string) => void;
};

type PreconDataValue = {
  subcontractors: Subcontractor[];
  addSubcontractor: (sub: Subcontractor) => void;
  updateSubcontractor: (id: string, updates: Partial<Subcontractor>) => void;
  deleteSubcontractor: (id: string) => void;
  getSubcontractor: (id: string) => Subcontractor | null;
  leads: Lead[];
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'receivedAt'> & { id?: string; receivedAt?: string }) => Lead;
  updateLead: (id: string, updates: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  getLead: (id: string) => Lead | null;
  /** True once THIS account's lead list has landed (keyed by account, like
   *  dailyReportsLoaded) — a lead opened by id before then must not seed a form. */
  leadsLoaded: boolean;
  /** Re-read the lead list now. A website lead is inserted on the server and
   *  its alert opens /lead-detail seconds later; the list is only read once
   *  (5-min stale, no realtime), so the screen asks for a fresh read. */
  refreshLeads: () => Promise<void>;
  getLeadsByStage: (stage: LeadStage) => Lead[];
  addLeadTouch: (leadId: string, kind: LeadTouch['kind'], body: string, byName?: string) => void;
  bidPackages: BidPackage[];
  bidPackageBids: BidPackageBid[];
  addBidPackage: (pkg: Omit<BidPackage, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => BidPackage;
  updateBidPackage: (id: string, updates: Partial<BidPackage>) => void;
  deleteBidPackage: (id: string) => void;
  getBidPackagesForProject: (projectId: string) => BidPackage[];
  getBidPackage: (id: string) => BidPackage | null;
  addBidPackageBid: (bid: Omit<BidPackageBid, 'id' | 'createdAt' | 'updatedAt' | 'submittedAt'> & { id?: string; submittedAt?: string }) => BidPackageBid;
  updateBidPackageBid: (id: string, updates: Partial<BidPackageBid>) => void;
  deleteBidPackageBid: (id: string) => void;
  getBidsForPackage: (packageId: string) => BidPackageBid[];
  cois: CertificateOfInsurance[];
  addCOI: (coi: CertificateOfInsurance) => void;
  updateCOI: (id: string, patch: Partial<CertificateOfInsurance>) => void;
  deleteCOI: (id: string) => void;
  getCOIsForSub: (subId: string) => CertificateOfInsurance[];
};

type DocsDataValue = {
  rfis: RFI[];
  addRFI: (rfi: Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => RFI;
  addRFIs: (rfis: RFI[]) => void;
  updateRFI: (id: string, updates: Partial<RFI>) => void;
  deleteRFI: (id: string) => void;
  getRFIsForProject: (projectId: string) => RFI[];
  permits: Permit[];
  addPermit: (permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>) => Permit;
  updatePermit: (id: string, updates: Partial<Permit>) => void;
  deletePermit: (id: string) => void;
  getPermitsForProject: (projectId: string) => Permit[];
  subPortalLinks: SubPortalLink[];
  /** True once the sub portal links for this account have loaded — from the
   *  server, or from the local cache when the server read fell back. Until
   *  then `getSubPortalLinkFor` returning nothing means "not known yet", NOT
   *  "this sub has no link": a screen that creates a link must wait for this. */
  subPortalLinksLoaded: boolean;
  upsertSubPortalLink: (link: SubPortalLink) => SubPortalLink;
  /** Store the server's access token on a local link. Local only — no write. */
  adoptSubPortalToken: (id: string, accessToken: string) => void;
  deleteSubPortalLink: (id: string) => void;
  getSubPortalLinkFor: (projectId: string, subcontractorId: string) => SubPortalLink | undefined;
  getSubPortalLinksForProject: (projectId: string) => SubPortalLink[];
  submittals: Submittal[];
  addSubmittal: (sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => void;
  addSubmittals: (subs: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>[]) => void;
  updateSubmittal: (id: string, updates: Partial<Submittal>) => void;
  deleteSubmittal: (id: string) => void;
  getSubmittalsForProject: (projectId: string) => Submittal[];
  /** Through submittal_append_review_cycle (#55): numbered on the server, so
   *  two devices never both write 'Cycle 2' and a cycle the portal closed is
   *  never overwritten. Shown at once; resolves with the server's number, or
   *  the reason it was not saved (also shown to him). */
  addReviewCycle: (submittalId: string, cycle: Omit<SubmittalReviewCycle, 'cycleNumber'> & { closesOpenCycle?: boolean }) => Promise<ReviewCycleResult>;
  oacMeetings: OACMeeting[];
  addOACMeeting: (meeting: OACMeeting) => void;
  updateOACMeeting: (id: string, patch: Partial<OACMeeting>) => void;
  deleteOACMeeting: (id: string) => void;
  getOACMeetingsForProject: (projectId: string) => OACMeeting[];
  warranties: Warranty[];
  addWarranty: (w: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id?: string; status?: Warranty['status']; claims?: WarrantyClaim[] }) => Warranty;
  updateWarranty: (id: string, updates: Partial<Warranty>) => void;
  deleteWarranty: (id: string) => void;
  getWarrantiesForProject: (projectId: string) => Warranty[];
  addWarrantyClaim: (warrantyId: string, claim: Omit<WarrantyClaim, 'id'>) => void;
  portalMessages: PortalMessage[];
  addPortalMessage: (msg: Omit<PortalMessage, 'id' | 'createdAt'>) => PortalMessage;
  markPortalMessagesRead: (projectId: string, side: 'gc' | 'client') => void;
  getPortalMessagesForProject: (projectId: string) => PortalMessage[];
  getUnreadPortalMessageCount: (projectId: string, side: 'gc' | 'client') => number;
  getTotalUnreadPortalCountForGc: () => number;
};

type StableActionsValue = {
  completeOnboarding: () => Promise<void>;
  /** Set or change the user's marketplace persona. Writes to AsyncStorage
   *  immediately (so the root layout's gate stops bouncing them to
   *  /persona-select) and mirrors to `public.profiles.user_role` server-side
   *  when online. */
  setUserRole: (role: UserRole) => Promise<void>;
  /** SYNC-F7: fire every debounced project sync now (AppState background /
   *  inactive, `pagehide` on web) so a kill inside the 800 ms window cannot
   *  lose the edit. Resolves once the writes have been sent or queued. */
  flushPendingProjectSyncs: () => Promise<void>;
  /** A GC-authored portal_messages insert, ordered behind the project's own
   *  write (utils/portalMessageWrite.ts has the why: RLS lock 1 refuses a
   *  message whose portalId the server's project row does not carry yet). */
  writePortalMessage: (row: Record<string, unknown>) => Promise<WriteOutcome>;
  /** Fold a schedule the server sent by realtime into the local project copy
   *  — no sync, no project updatedAt (it IS the server's). Schedule Pro calls
   *  it for every server copy it adopts, so the copy every owner write is
   *  stamped against is never older than the screen's
   *  (utils/fieldScheduleUpdate.ts absorbServerScheduleTasks has the why).
   *  `adopt` — the screen took this copy WHOLE (it was quiet): the local copy
   *  takes it whole too, with the schedule's save stamp, unless a sync of
   *  this project is still out (then the field-key merge as before). Other
   *  screens that write `project.schedule` then send what the grid shows.
   *  `adopt.baselines` — the copy's named baselines, taken with it when whole
   *  (a baseline captured on another device must not be written away by the
   *  next save from any screen of this one). */
  absorbServerSchedule: (projectId: string, tasks: ScheduleTask[], adopt?: { stamp: string | null; baselines?: readonly unknown[]; activeBaselineId?: string | null }) => void;
  /** #12/#65 (wave 4): republish this project's homeowner-portal snapshot on
   *  the next pass even though none of the provider's lists moved — for what
   *  the publish reads only at publish time (the contract, selections, the
   *  closeout binder). Drops the job's stored signature (an unchanged one
   *  would settle the pass without publishing), marks it, and schedules a
   *  pass. Owner devices only publish; the pass still waits for every list to
   *  be a server read of the current foreground. */
  requestPortalPublish: (projectId: string) => void;
  /** #82 (wave 4): re-read the invoices and AIA pay applications NOW — what a
   *  "client paid" notification opens onto. Honours the same guard as the
   *  foreground pass: while this device has an invoice insert or update on
   *  the wire, the invoices read is OWED (it runs when the write reports), so
   *  it can never put the pre-edit row back on screen. Resolves when the
   *  reads it started have answered. */
  refetchInvoicesNow: () => Promise<void>;
  /** #8/#128 (wave 4): how many of this session's writes and photo uploads
   *  for this project are still waiting — what leaving the job would discard. */
  countQueuedForProject: (projectId: string) => Promise<number>;
  /** Integration round 3: the part of countQueuedForProject that is under
   *  Not saved (refused or parked lines) — a flush never sends those, so the
   *  Leave dialog names them and opens the sheet instead of "Sync first". */
  countUnsavedForProject: (projectId: string) => Promise<number>;
  /** Whether this project has a debounced sync waiting or a write on the wire
   *  (Schedule Pro's "busy" — utils/scheduleMerge.ts has the rule). */
  isProjectSyncUnconfirmed: (projectId: string) => boolean;
  /** Called after every project sync reports (landed, queued or failed). */
  onProjectSyncSettled: (listener: () => void) => () => void;
};

/** Extra intent a caller can attach to a change-order update that approves it.
 *  `anchorTaskId` is the task the user chose (in the reflow preview) to absorb
 *  the CO's schedule impact days; it also lets a GC place the days on a CO that
 *  was approved remotely — through the client portal, say — and had no
 *  identifiable anchor at the time. See utils/coScheduleReflowCore.ts. */
export type ChangeOrderReflowIntent = {
  anchorTaskId?: string;
  /** The approval did not come from the GC (the client portal reconciler,
   *  which runs from the root while he may be editing that job in Schedule
   *  Pro): do NOT reflow the schedule behind him. Record the "place these
   *  days" marker instead; the project screen's preview applies them. */
  deferReflow?: boolean;
};

type CrossDomainValue = {
  updateChangeOrder: (id: string, updates: Partial<ChangeOrder>, reflow?: ChangeOrderReflowIntent) => Promise<RecordWriteOutcome>;
  addDailyReport: (report: DailyFieldReport) => void;
  updateDailyReport: (id: string, updates: Partial<DailyFieldReport>) => void;
  convertLeadToProject: (leadId: string) => string | null;
  /** `overrideNote` — the risk-override audit line when he awards despite
   *  compliance blockers; folded into the new commitment's notes in the same
   *  write (a follow-up updateCommitment read a stale list without it). */
  awardBidPackage: (packageId: string, bidId: string, opts?: { overrideNote?: string }) => string | null;
  sendToClientPortal: (args: { kind: SendableItemKind; itemId: string; projectId: string }) => Promise<void>;
  recallFromClientPortal: (args: { kind: SendableItemKind; itemId: string; projectId: string }) => Promise<void>;
  /** `held` (#28, wave 4): RFIs / submittals left as drafts because their
   *  INSERT is still queued — the server has not numbered them yet. */
  batchSendToClientPortal: (args: { items: { kind: SendableItemKind; itemId: string }[]; projectId: string }) => Promise<{ sent: number; held: number }>;
  importData: (payload: { projects?: Project[]; contacts?: Contact[]; subcontractors?: Subcontractor[] }) => { projects: number; contacts: number; subcontractors: number };
};

// Deleted-project signal — a deliberately tiny, low-churn observable that a
// provider-sibling below ProjectProvider (SafetyContext) subscribes to so it
// can prune its own project-scoped collections when a project is deleted. Kept
// OUT of CoreDataContext on purpose: this value changes only on an actual
// delete, so putting it here means the (many) useProjects() consumers do not
// re-render for it, and the coupling is a single named seam rather than a field
// buried in the big core bucket.
type ProjectDeletionValue = {
  /** The id of the most-recently-deleted project, or null before any delete. */
  deletedProjectId: string | null;
  /** Monotonic counter — bumped once per delete so repeats of the same id are
   *  still observed as distinct events. 0 means "no delete has happened". */
  tick: number;
};

const ProjectDeletionContext = createContext<ProjectDeletionValue | null>(null);

const CoreDataContext = createContext<CoreDataValue | null>(null);
const FinancialsDataContext = createContext<FinancialsDataValue | null>(null);
const FieldDataContext = createContext<FieldDataValue | null>(null);
const PreconDataContext = createContext<PreconDataValue | null>(null);
const DocsDataContext = createContext<DocsDataValue | null>(null);
const StableActionsContext = createContext<StableActionsValue | null>(null);
const CrossDomainContext = createContext<CrossDomainValue | null>(null);

// ─── Inner provider (holds the full hook body verbatim) ───────────────────────
function ProjectProviderInner({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const userEmail = user?.email ?? null;
  // RT-R1: the one place that asks "can this device reach MAGE as this user
  // right now?". It lives HERE, in the context whose loaders swallow the
  // errors, so any screen reading project data can gate an absolute claim on
  // it without also mounting the attention hook (audit 2026-09-07 "Do now"
  // #1 — the signal existed and half its consumers dropped it).
  const reachability = useMageReachability();

  const [projects, setProjects] = useState<Project[]>([]);
  // Latest list for updateProject, which may be called several times in one
  // press (the payment-terms auto-stamp loops over every old portal). Built
  // from the render-time `projects`, each call started from the same list and
  // the last setProjects won: N-1 projects lost their change on the device
  // while the server kept it. Same pattern as punchItemsRef below.
  const projectsRef = useRef<Project[]>([]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  // #1 (wave 5): take jobs that never reached the server off this phone —
  // the Discard of their Not-saved create. Assigned next to deleteProject
  // (it needs forgetProjectsLocally, declared far below).
  const dropLocalOnlyJobsRef = useRef<(ids: ReadonlySet<string>) => void>(() => undefined);
  // A load must not undo a write made while it was out (utils/projectsLoadGuard
  // has the bug). Every local project write takes a sequence number here — in
  // syncProjectToSupabase, which every synced write goes through, and in
  // absorbServerSchedule — and the loader keeps the device copy of any project
  // written after the number it started at. `projectsLoadSinceRef` is that
  // start number for the load whose result `projects` holds.
  const projectWriteLogRef = useRef(newProjectWriteLog());
  const projectsLoadSinceRef = useRef(0);
  // #90: the jobs the newest projects load found he was removed from (the
  // hydration pass filters them the same way), and the cleanup it owes once:
  // their child records off this phone, their queued writes to the failure
  // path, and one sentence telling him why the job left.
  const projectsLoadRevokedRef = useRef<ReadonlySet<string>>(new Set());
  const revokedCleanupOwedRef = useRef<{ userId: string | null; names: Map<string, string> } | null>(null);
  // #90 review round · every job this account was removed from (or left) in
  // this session, id → name: a child list that hydrates late is swept again
  // against it. A job the server returns again leaves it (re-invited).
  const revokedSweepRef = useRef<Map<string, string>>(new Map());
  const [revokedCleanup, setRevokedCleanup] = useState<Map<string, string> | null>(null);
  // Jobs he LEFT himself this session (forgetSharedProject): a later load
  // that finds them gone must not tell him the owner removed him.
  const leftByMeRef = useRef<Set<string>>(new Set());
  // Per project, the schedule tasks the server last sent (a load or a
  // realtime event) — the 3-way base absorbServerSchedule merges against.
  const serverScheduleTasksRef = useRef<Map<string, ScheduleTask[]>>(new Map());
  // The rest of the load's snapshot, for the hydration pass to apply the same
  // rule the loader did (#8, #96): the ids whose write was unconfirmed when the
  // load began, the schedule base as it stood then, and the tasks the load
  // read — consumed by the first hydration after it, so a later cache write
  // (saveProjectsMutation → setQueryData) never folds the server copy over an
  // edit made after the load.
  const projectsLoadPendingRef = useRef<ReadonlySet<string>>(new Set());
  // Wave-4 final fix: the ids in that pending set ONLY because a line sits
  // under Not saved (no queued or unconfirmed write of them). Kept whole like
  // the rest, but they never owe a re-read — see projectsReloadOwedAfterLoad.
  const projectsLoadLedgerOnlyRef = useRef<ReadonlySet<string>>(new Set());
  const projectsLoadBaseRef = useRef<ReadonlyMap<string, ScheduleTask[]>>(new Map());
  const projectsLoadTasksRef = useRef<Map<string, ScheduleTask[]>>(new Map());
  // A load kept a device row whole instead of the server's (#96): re-read once
  // nothing is pending, or what else it read (a foreman's progress) stays
  // hidden until the next foreground. See settleOwedProjectsReload.
  const projectsReloadOwedRef = useRef(false);
  // Review round 2: the owed flag is decided by the load whose result is
  // COMMITTED, in the hydration pass — not by every queryFn. Each load takes a
  // number; only the newest one started (a superseded fetch's result never
  // reaches `projects`) marks that it landed, and the hydration pass consumes
  // the mark and sets the flag from what it kept. A cache write re-running the
  // hydration leaves the flag alone. Before, only a load could raise the flag
  // and only the settle cleared it, so a clean re-read after a kept one fired
  // a second full reload — one per save while he kept editing on web.
  const projectsLoadSeqRef = useRef(0);
  const projectsLoadLandedRef = useRef(false);
  // True once the projects query has settled AND local state has been hydrated
  // from it. Screens use this to tell "still loading" apart from "genuinely not
  // found" — getProject(id) returns null in BOTH cases, so a cold deep-link
  // would otherwise flash a false "Project not found" for a frame.
  const [projectsLoaded, setProjectsLoaded] = useState<boolean>(false);
  // Explicit deleted-project signal (see ProjectDeletionContext below). Set ONLY
  // by deleteProject, which knows the exact id being removed — so downstream
  // provider-siblings (SafetyContext) prune a KNOWN projectId rather than
  // inferring one from an array diff. `tick` is a monotonic counter so a
  // re-delete of the same id (or two deletes in a row) is still observed as a
  // distinct event; it starts at 0, so a fresh mount / initial hydrate carries
  // NO delete to act on. A logout / tenant-switch never calls deleteProject, so
  // this signal is never emitted on a full-clear — the catastrophic
  // false-prune-all path simply cannot originate here.
  const [projectDeletion, setProjectDeletion] = useState<{ deletedProjectId: string | null; tick: number }>({ deletedProjectId: null, tick: 0 });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  // The settings as of the LAST write, readable synchronously. updateSettings
  // used to spread its render closure's `settings`, so two writers in the same
  // tick (the ask sheet saving a company name, then the terms, in one press)
  // left the second one merging onto the pre-press object and undoing the
  // first. Every settings state write goes through commitSettingsState, and
  // every merge reads this ref.
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  // Terms writes the offline queue cannot see yet. supabaseWrite tries the
  // network FIRST and only queues after a failure, so while that attempt is
  // out termsWritesPending reads an empty queue — and a settings refetch
  // started before the write landed returns a row without the answer. The
  // loader treats the device answer as pending when a write was in flight as
  // its read began or as it returned, or one started in between (the epoch
  // moved) — any of those can mean the row predates the answer.
  const termsWritesInFlightRef = useRef(0);
  const termsWriteEpochRef = useRef(0);
  // Finding 15 — the same race for EVERY settings field. The launch read (or a
  // retry, or a web refocus) that started before he saved his phone number
  // used to land after it and put the old row back in state and on the
  // device; his next settings write then sent the old number to the server.
  // settingsWriteSeqRef moves on every write made on a LOADED profile
  // (updateSettings, the held-edit flush, savePaymentTerms);
  // settingsRowWritesInFlightRef counts whole-row saves still on the wire. The
  // loader reads both around the select (utils/settingsLoadGuard
  // settingsAfterRead) and keeps the device's settings when either says the
  // row may be older, owing one re-read (settingsRereadOwedRef) for when the
  // writes have landed.
  const settingsWriteSeqRef = useRef(0);
  const settingsRowWritesInFlightRef = useRef(0);
  const settingsRereadOwedRef = useRef(false);
  // The write sequence each settings object handed to React Query was built
  // at. The data effect commits a query result only when nothing was written
  // since it was built — the query can resolve, and its effect run, after an
  // edit made in between. An object with no entry here was not produced by
  // this provider and is never committed or marked loaded.
  const settingsDataSeqRef = useRef(new WeakMap<AppSettings, number>());
  // How many FIRST profile reads (no device copy) have failed for this
  // account — each one doubles the next read's deadline
  // (firstProfileReadTimeoutMs). Keyed by account; a success resets it.
  const settingsFirstReadFailuresRef = useRef<{ owner: string; n: number }>({ owner: '', n: 0 });
  const commitSettingsState = useCallback((next: AppSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);
  // Which account's settings are REALLY in state. Until one of the two loads
  // below lands, `settings` is DEFAULT_SETTINGS — and the profiles read waits
  // on the network (bounded only on a first read with no device copy; see
  // FIRST_PROFILE_READ_TIMEOUT_MS) while the splash hands off after ~1 s. Anything
  // that merges onto settingsRef in that window writes DEFAULT branding: the
  // ask gate would re-ask a GC who already answered, savePaymentTerms would
  // clobber the device cache, and updateSettings would send DEFAULT contact,
  // address and licence over his profiles row. Keyed by account so a sign-in
  // as someone else starts unloaded again.
  const settingsOwnerKey = userId ?? 'signed-out';
  const [settingsLoadedFor, setSettingsLoadedFor] = useState<string | null>(null);
  const settingsLoadedForRef = useRef<string | null>(null);
  const markSettingsLoaded = useCallback((key: string) => {
    settingsLoadedForRef.current = key;
    setSettingsLoadedFor(key);
  }, []);
  const settingsLoaded = settingsLoadedFor === settingsOwnerKey;
  // updateSettings calls made before the load: kept here and written, merged
  // onto the loaded row, the moment it lands (effect after saveSettingsMutation).
  // Finding 14: only the fields he CHANGED are kept (heldSettingsPatch), and
  // they land one level deep (applyHeldSettings). The old snapshot held the
  // whole DEFAULT-based `branding` a screen built, and replaced his saved
  // company name, contact and licence with '' when the row arrived. Cleared on
  // an account change, so one account's held edit never lands on another's row.
  const pendingSettingsUpdatesRef = useRef<Partial<AppSettings> | null>(null);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const [userRole, setUserRoleState] = useState<UserRole | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [bidPackages, setBidPackages] = useState<BidPackage[]>([]);
  const [bidPackageBids, setBidPackageBids] = useState<BidPackageBid[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // Mirror of `invoices` that addInvoice / updateInvoice / the portal send move
  // SYNCHRONOUSLY, so a create followed by an edit in one async flow (the
  // invoice screen's Send) reads the list that holds the new invoice — see
  // utils/invoiceWrites. Same pattern as punchItemsRef below.
  const invoicesRef = useRef<Invoice[]>([]);
  useEffect(() => { invoicesRef.current = invoices; }, [invoices]);
  // This device's invoice INSERTs still reporting, by id — updateInvoice
  // orders its UPDATE behind them.
  const invoiceInsertsRef = useRef<Map<string, Promise<WriteOutcome>>>(new Map());
  // Invoice UPDATEs this device has on the wire. A re-read while one is out
  // would put the pre-edit server row on screen (#48's foreground refetch
  // waits for these).
  const invoiceWritesInFlightRef = useRef(0);
  // #23 round 2: a foreground re-read of the invoices skipped because a write
  // was out is OWED, not dropped — the portal publish waits for this list's
  // read in the new epoch, and nothing else would re-read it. Paid by the last
  // invoice write to report (payInvoicesReloadIfOwed).
  const invoicesReloadOwedRef = useRef(false);
  const payInvoicesReloadIfOwed = () => {
    if (!invoicesReloadOwedRef.current) return;
    if (invoiceInsertsRef.current.size > 0 || invoiceWritesInFlightRef.current > 0) return;
    const uid = liveUserIdRef.current;
    invoicesReloadOwedRef.current = false;
    if (uid) void queryClient.invalidateQueries({ queryKey: ['invoices', uid] });
  };
  // How each of this session's invoice INSERTs ended (awaitInvoiceInsert
  // answers after the pending entry above is gone).
  const invoiceInsertOutcomesRef = useRef<Map<string, WriteOutcome>>(new Map());
  // Same for change-order INSERTs: the voice mic drafts a CO and opens it
  // ~250 ms later, so on a weak link Send & Save's UPDATE can reach PostgREST
  // while the insert is still on the wire — a 0-row "success" that read as
  // "It is saved." updateChangeOrder waits on these before its direct write.
  const changeOrderInsertsRef = useRef<Map<string, Promise<WriteOutcome>>>(new Map());
  // #40 · Audit entries not yet appended on the server, by CO — the in-memory
  // copy of CO_AUDIT_PENDING_KEY. Declared here (not beside appendCoAudit) so
  // the change_orders loader can lay them back on the rows it reads.
  // coAuditLoadRef settles once this account's stored copy has been read in;
  // every persist and the loader wait on it, so a stash made during the read
  // can never overwrite the stored entries with a map that lacks them.
  const pendingCoAuditRef = useRef<Map<string, COAuditEntry[]>>(new Map());
  const coAuditLoadRef = useRef<Promise<void>>(Promise.resolve());
  const coAuditOwnerRef = useRef<string>('');
  // CO writes (UPDATE or audit append) this device has out, and when each id's
  // last one settled — a change_orders read keeps the device copy of those ids
  // (utils/projectContextPure.coIdsWrittenDuringRead). Realtime now re-reads on
  // every updated_at change, including the echo of this device's own write.
  const coWriteTouchRef = useRef<Map<string, { inFlight: number; settledAt: number }>>(new Map());
  const beginCoWrite = useCallback((id: string) => {
    const t = coWriteTouchRef.current.get(id) ?? { inFlight: 0, settledAt: 0 };
    coWriteTouchRef.current.set(id, { inFlight: t.inFlight + 1, settledAt: t.settledAt });
  }, []);
  // Review round 1 · the same for RFI / submittal edits (a read that predates
  // one must not hand back the older row and its older server stamp) and for
  // the four plan tables (#74's re-read).
  const proDocWriteTouchRef = useRef<WriteTouches>(new Map());
  const planWriteTouchRef = useRef<WriteTouches>(new Map());
  // Per RFI / submittal: the number of the latest edit this device sent. The
  // read-back after a write adopts the server's stamp only if no later edit
  // went out meanwhile (that one's own read-back will).
  const proDocEditSeqRef = useRef<Map<string, number>>(new Map());
  const endCoWrite = useCallback((id: string) => {
    const t = coWriteTouchRef.current.get(id) ?? { inFlight: 1, settledAt: 0 };
    coWriteTouchRef.current.set(id, { inFlight: Math.max(0, t.inFlight - 1), settledAt: Date.now() });
  }, []);
  // #23 · Projects whose portal THIS device changed since their last settled
  // publish, with a mark counter (a mark made while that project's publish is
  // running must survive it). '*' = every owned portal: the post-load pass and
  // a profile change.
  const portalDirtyRef = useRef<Map<string, number>>(new Map([['*', 1]]));
  const portalDirtySeqRef = useRef(1);
  // Warranties persist without a query cache: the last list the provider read
  // or wrote, for persistWarranties' diff.
  const portalWarrantyBaseRef = useRef<Warranty[]>([]);
  const markPortalDirty = useCallback((ids: Iterable<string>) => {
    for (const id of ids) {
      portalDirtySeqRef.current += 1;
      portalDirtyRef.current.set(id, portalDirtySeqRef.current);
    }
  }, []);
  // A direct UPDATE for a row whose INSERT may still be queued (portal-state
  // writes, commitment edits) — ordered behind it, see
  // utils/invoiceWrites.writeBehindQueuedInsert. Refs only, so it is stable.
  const updateBehindQueuedInsert = useCallback((table: string, payload: Record<string, unknown> & { id: string }) => {
    return writeBehindQueuedInsert({
      pendingInsert: table === 'invoices' ? invoiceInsertsRef.current.get(payload.id)
        : table === 'change_orders' ? changeOrderInsertsRef.current.get(payload.id)
        : undefined,
      getQueue: getOfflineQueue,
      enqueue: addToOfflineQueue,
      send: (t, data) => supabaseWrite(t, 'update', data),
    }, table, payload);
  }, []);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [prequalPackets, setPrequalPackets] = useState<PrequalPacket[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyFieldReport[]>([]);
  // Which account's change orders / daily reports are in state. Set in the
  // SAME effect that commits the rows, so the flag and the rows land in one
  // render — a flag derived from `query.data` would read true one render
  // before the rows it vouches for. Keyed by account so a sign-in as someone
  // else reads "loading" until THEIR rows land, not "loaded" on the last
  // account's. ('' = signed out, which loads the device copy.)
  const [changeOrdersLoadedFor, setChangeOrdersLoadedFor] = useState<string | null>(null);
  // Wave 5 (home #151): the same stamp for the invoices list.
  const [invoicesLoadedFor, setInvoicesLoadedFor] = useState<string | null>(null);
  const [dailyReportsLoadedFor, setDailyReportsLoadedFor] = useState<string | null>(null);
  const [leadsLoadedFor, setLeadsLoadedFor] = useState<string | null>(null);
  const [photosLoadedFor, setPhotosLoadedFor] = useState<string | null>(null);
  const [punchItemsLoadedFor, setPunchItemsLoadedFor] = useState<string | null>(null);
  const [fieldTickets, setFieldTickets] = useState<FieldTicket[]>([]);
  const [delayEvents, setDelayEvents] = useState<DelayEvent[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [buildingAccessRules, setBuildingAccessRules] = useState<BuildingAccessRules[]>([]);
  const [accessReservations, setAccessReservations] = useState<AccessReservation[]>([]);
  const [deliveryReceipts, setDeliveryReceipts] = useState<DeliveryReceipt[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  // Mirror of `punchItems` (see submittalsRef note below) so batch adds looped
  // synchronously read the just-inserted rows instead of a stale render closure
  // — otherwise each setState clobbers the previous and only the last survives.
  const punchItemsRef = useRef<PunchItem[]>([]);
  useEffect(() => { punchItemsRef.current = punchItems; }, [punchItems]);
  // Pin writes still in flight (or settled a moment ago), per item id. The
  // punch loader keeps this device's pin for those rows, so a SELECT that
  // raced the UPDATE cannot put the old pin back on screen.
  const pinWriteTrackerRef = useRef(new Map<string, { inFlight: number; settledAt: number }>());
  // A new account starts with nothing pending (its loader must not keep A's pins).
  useEffect(() => { pinWriteTrackerRef.current = new Map(); }, [userId]);
  const trackPinWrite = useCallback((id: string, carries: boolean, p: Promise<unknown>) => {
    if (!carries) return;
    const map = pinWriteTrackerRef.current;
    const entry = map.get(id) ?? { inFlight: 0, settledAt: 0 };
    entry.inFlight += 1;
    map.set(id, entry);
    void p.catch(() => undefined).finally(() => {
      // The map may have been replaced by a sign-out reset meanwhile.
      const e = pinWriteTrackerRef.current.get(id);
      if (!e) return;
      e.inFlight = Math.max(0, e.inFlight - 1);
      e.settledAt = Date.now();
    });
  }, []);
  // updateSubcontractor (declared above updatePunchItems) carries a sub's
  // rename onto his punch items through this.
  const updatePunchItemsRef = useRef<((ids: readonly string[], updates: PunchBatchUpdates) => void) | null>(null);
  const [projectPhotos, setProjectPhotos] = useState<ProjectPhoto[]>([]);
  // Latest gallery for stagePunchPhoto, whose callers can hold an older render.
  const projectPhotosRef = useRef<ProjectPhoto[]>([]);
  useEffect(() => { projectPhotosRef.current = projectPhotos; }, [projectPhotos]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  const [rfis, setRfis] = useState<RFI[]>([]);
  // Mirror of `rfis` (see submittalsRef note below) so batch adds looped
  // synchronously assign advancing per-project numbers off the just-inserted
  // rows instead of recomputing from a stale closure (which collides all rows
  // on the same number and drops all but the last on setState).
  const rfisRef = useRef<RFI[]>([]);
  useEffect(() => { rfisRef.current = rfis; }, [rfis]);
  const [submittals, setSubmittals] = useState<Submittal[]>([]);
  // Mirror of `submittals` kept in sync so add handlers called repeatedly in a
  // single synchronous loop (e.g. extract-submittals bulk save, dev-seeder)
  // read the just-inserted rows instead of a stale render closure — otherwise
  // every iteration computes the same nextNumber and each setState clobbers the
  // previous, so only the last row survives.
  const submittalsRef = useRef<Submittal[]>([]);
  useEffect(() => { submittalsRef.current = submittals; }, [submittals]);
  const [oacMeetings, setOacMeetings] = useState<OACMeeting[]>([]);
  const [cois, setCois] = useState<CertificateOfInsurance[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [aiaPayApps, setAiaPayApps] = useState<SavedAIAPayApp[]>([]);
  // Latest-value mirrors for the portal send / recall path (#35, #45): it
  // looks an item up and re-maps its list, and a callback captured before the
  // last render (or a send right after a create in the same handler) read a
  // list without the item — "Item not found", or a stale map that dropped
  // whatever changed in between. The mutators that commit a list move its ref
  // in the same breath; the effects follow every other commit.
  const changeOrdersRef = useRef<ChangeOrder[]>([]);
  useEffect(() => { changeOrdersRef.current = changeOrders; }, [changeOrders]);
  const dailyReportsRef = useRef<DailyFieldReport[]>([]);
  useEffect(() => { dailyReportsRef.current = dailyReports; }, [dailyReports]);
  const aiaPayAppsRef = useRef<SavedAIAPayApp[]>([]);
  useEffect(() => { aiaPayAppsRef.current = aiaPayApps; }, [aiaPayApps]);
  const warrantiesRef = useRef<Warranty[]>([]);
  useEffect(() => { warrantiesRef.current = warranties; }, [warranties]);
  // Which account's warranties are in state — the provider-level portal sync
  // (#23) must not publish a Documents section built before they arrived.
  const [warrantiesLoadedFor, setWarrantiesLoadedFor] = useState<string | null>(null);
  // Bumped to re-read warranties (not a react-query key): the foreground pass
  // and retryRemoteReads (#23 round 2).
  const [warrantiesReload, setWarrantiesReload] = useState(0);
  const [subPortalLinks, setSubPortalLinks] = useState<SubPortalLink[]>([]);
  const [subPortalLinksLoaded, setSubPortalLinksLoaded] = useState<boolean>(false);
  // SYNC-F7: each entry keeps its `run` so flushPendingProjectSyncs can fire it
  // immediately on background — a bare timer dies with the process. An entry
  // stays in the map until its write has REPORTED (landed, queued, or refused
  // terminally), so a flush that arrives while the write is in flight can still
  // re-issue it; `timer` is null once the debounce has fired. `inFlight` is
  // set the moment `run` starts (A-8): the flush skips those — their write is
  // already on the wire or queued, and re-issuing it sent the row twice.
  // `sendsSchedule` (#25, second writer): whether this sync carries the
  // schedule. A sync that replaces a still-waiting one inherits it — see
  // projectSyncSendsSchedule.
  type PendingProjectSync = { timer: ReturnType<typeof setTimeout> | null; sendsSchedule: boolean; inFlight: boolean; run: () => Promise<void> };
  const syncDebounceMap = useRef<Map<string, PendingProjectSync>>(new Map());
  // #8 (review round 1): every sync whose write is on the wire, entry →
  // project id, from the moment its run starts until it reports. The map
  // above loses sight of one when a newer edit replaces it mid-write;
  // unconfirmedProjectSyncIds reads both.
  const inFlightProjectSyncsRef = useRef<Map<PendingProjectSync, string>>(new Map());
  // #4 (wave 4) · A NEW job's own create write, by project id, from the moment
  // addProject fires it until the projects row reports ('synced' / 'queued' /
  // 'failed') — what addProject returns. (The children are ordered behind the
  // job by utils/offlineQueue; see addProject.)
  const projectCreateWritesRef = useRef<Map<string, Promise<WriteOutcome>>>(new Map());
  // Project ids the last successful server load returned, plus any whose
  // schedule-carrying upsert has since landed. An owner upsert may leave the
  // schedule out ONLY for these: for a project the server may not hold yet (a
  // local-only or offline-created one) the upsert is the INSERT, and a row
  // created without its schedule would replace the device copy's schedule
  // with nothing on the next server-first load.
  const serverProjectIdsRef = useRef<Set<string>>(new Set());
  // #7: serverProjectIdsRef has taken in the persisted copy for this account.
  const serverIdsSeededRef = useRef(false);
  // #1 fix round 2: ids the server has EVER confirmed for this account — only
  // grows (withServerConfirmed); feeds the local-only rule, never the
  // schedule / create decisions above.
  const everConfirmedProjectIdsRef = useRef<Set<string>>(new Set());
  const everConfirmedSeededRef = useRef(false);

  // #6 — CROSS-TENANT. Every ref above describes ONE account's projects, and
  // this provider stays mounted across a sign-out (logout wipes storage and
  // clears the query cache, then router.replace — nothing remounts). The load
  // guard kept the previous account's written projects on the signed-out
  // load and on the next account's zero-row or failed load, so B saw A's
  // projects as full owner copies (estimate and portal credentials included),
  // with no spinner, and B's first addProject saved them into B's cache for
  // good. Reset here, DURING RENDER (React's "adjust state when a prop
  // changes" pattern, keyed on state so a discarded render cannot skip it):
  // an effect would land after the first commit, and a child could read A's
  // list for a frame. Refs are reset idempotently. Not a remount of the
  // provider: that would also remount the navigator below it mid-sign-in.
  //
  // Only when an account LEAVES (A → signed out, A → B): signed out → A is a
  // cold launch restoring the session, or a sign-in after a sign-out that
  // already reset — blanking there would trade the device copy the signed-out
  // pass put on screen for a spinner until the network answers, on job-site
  // LTE, for no one's benefit.
  //
  // Review round 1: an account can also leave WITHOUT a signed-in → signed-in
  // render — a session that expired (AuthContext keeps the device cache then),
  // or a cold launch whose stored session was dropped. The signed-out pass
  // then puts that account's device copy on screen, and the next sign-in
  // arrives as signed out → B. So on signed out → X the list is kept only
  // when it is known to be X's: the signed-out pass records whose cache it
  // read (the device's last-user marker), and anything else — another
  // account, or no marker — gets the full reset.
  const liveUserIdRef = useRef<string | null>(userId);
  // #112 / #90: an EMPTY successful SELECT replaces the device copy only when
  // it was answered to this user's live bearer (utils/projectContextPure
  // emptyReadAuthoritative has the why: an expired token reads as anon, and
  // RLS answers anon with zero rows and no error). Checked only on the empty
  // path — a non-empty result cannot have come from the anon key.
  // Review round 1: the bearer is read BEFORE the SELECT too. A token that is
  // live only after the read proves nothing — a retryable refresh failure
  // sends the anon key, and a later getSession() can then refresh fine — so
  // the read must have gone out with a token that had runway (no refresh on
  // the way), and the token must be the same one after.
  const readBearer = async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession();
      return bearerTokenForRead(data?.session, Date.now());
    } catch {
      return null;
    }
  };
  const currentBearer = async (): Promise<string | null> => {
    try {
      const { data } = await supabase.auth.getSession();
      const t = data?.session?.access_token;
      return typeof t === 'string' && t.length > 0 ? t : null;
    } catch {
      return null;
    }
  };
  const emptyReadTrusted = async (loadUserId: string | null, bearerBefore: string | null): Promise<boolean> => {
    if (!loadUserId || liveUserIdRef.current !== loadUserId || !bearerBefore) return false;
    const [sessionUserId, bearerAfter] = await Promise.all([
      currentSessionUserId().catch(() => null),
      currentBearer(),
    ]);
    return emptyReadAuthoritative({ loadUserId, liveUserId: liveUserIdRef.current, sessionUserId, bearerBefore, bearerAfter });
  };
  // Wave 4 #6 · The child lists' cache write, owner-checked. queryClient.clear()
  // on sign-out cancels a query but not its queryFn: a SELECT sent with A's
  // token came back AFTER the sign-out wipe and wrote A's invoices / reports /
  // photos back into the un-namespaced key — where B, on the same phone, saw
  // them the first time B's own read of that list failed. The check runs at
  // the call, i.e. after the loader's last await (loadLocal, the queue and
  // ledger reads, the audit wait): that is where a sign-out lands. The throw
  // is rethrown past each loader's cache fallback, as the projects loader
  // does, and retryUnlessStaleAccount never retries it.
  const saveOwnedLocal = async (loadUserId: string | null, key: string, data: unknown): Promise<void> => {
    if (liveUserIdRef.current !== loadUserId) throw new StaleAccountLoadError();
    await saveLocal(key, data);
  };

  // #23 (data-session critic) · Which portal-fed lists' LAST load came from
  // the server, per account. Each loader below stamps its list on its server
  // branch and clears it on the cache fallback — the "*Loaded" flags are set
  // either way, so they cannot tell a server list from yesterday's cache, and
  // a publish from a cached (or empty-because-failed) list pulls the missing
  // items off the homeowner's portal (#44). portalSyncReady waits on all of
  // them. A load for an account that is no longer signed in stamps nothing.
  // Round 2: …and read since the latest return to the foreground. Each loader
  // captures portalReadEpochRef when its read STARTS and passes it back here;
  // the foreground pass bumps the epoch before it re-reads anything, so a list
  // read before it (the 07:00 copy of the daily reports) cannot feed a publish.
  const [portalServerReads, setPortalServerReads] = useState<PortalServerReads>(EMPTY_PORTAL_SERVER_READS);
  const portalReadEpochRef = useRef(EMPTY_PORTAL_SERVER_READS.epoch);
  // portalListsFromServer at publish time (assigned each render further down;
  // the foreground pass drops it synchronously).
  const portalListsServerRef = useRef(false);
  // #15 (wave 4): the AIA list's server read, the same way (assigned each
  // render; a return to the foreground moves the epoch, which stops a pass).
  const portalAiaFreshRef = useRef(false);
  const notePortalRead = (list: PortalFedList | PortalSideList, loadUserId: string | null, fromServer: boolean, readEpoch: number) => {
    if (!loadUserId || liveUserIdRef.current !== loadUserId) return;
    setPortalServerReads(prev => notePortalListRead(prev, list, loadUserId, fromServer, readEpoch));
  };
  // #90 · A zero-row projects read may revoke jobs only when a SECOND,
  // independent zero-row read under a checked bearer agrees
  // (revocationConfirmed) — forgetting a job discards its unsent writes, the
  // one step here that cannot be undone.
  const confirmNoProjects = async (loadUserId: string | null): Promise<boolean> => {
    const bearerBefore = await readBearer();
    if (!bearerBefore) return false;
    try {
      const { data, error } = await supabase.from('projects').select('id').limit(1);
      if (error || !data || data.length > 0) return false;
      return await emptyReadTrusted(loadUserId, bearerBefore);
    } catch {
      return false;
    }
  };
  // Bumped by every account reset below; blocks declared later in this
  // provider (their state lives below this line) reset themselves on it.
  const accountEpochRef = useRef(0);
  const signedOutCacheOwnerRef = useRef<string | null | undefined>(undefined);
  // Review round 2: the account whose list `projects` holds (set by the
  // hydration pass, or here when the signed-out pass's copy is kept). Until it
  // names this account, "no copy in the list" does not mean "deleted here" —
  // see withDeviceCopies.
  const projectsHydratedForRef = useRef<string | null | undefined>(undefined);
  const [projectsOwner, setProjectsOwner] = useState<string | null>(userId);
  if (projectsOwner !== userId) {
    // Signed out → X keeps what is on screen only when the signed-out pass
    // read X's own device copy. Every per-account list counts here, not only
    // projects: with no projects, the previous account's leads, contacts or
    // subs from that pass stayed on X's screens until X's reads landed.
    const accountLeft = projectsOwner !== null || signedOutCacheOwnerRef.current !== userId;
    setProjectsOwner(userId);
    liveUserIdRef.current = userId;
    signedOutCacheOwnerRef.current = undefined;
    projectsHydratedForRef.current = !accountLeft && projects.length > 0 ? userId : undefined;
    if (accountLeft) {
      // Lists declared further down (plans, portal messages) reset in their
      // own render-phase block, keyed on this.
      accountEpochRef.current += 1;
      // The seq carries forward — see resetProjectWriteLog.
      projectWriteLogRef.current = resetProjectWriteLog(projectWriteLogRef.current);
      projectsLoadSinceRef.current = projectWriteLogRef.current.seq;
      projectsLoadPendingRef.current = new Set();
      projectsLoadLedgerOnlyRef.current = new Set();
      // #90: the last account's "removed from" verdicts are not this one's.
      projectsLoadRevokedRef.current = new Set();
      revokedCleanupOwedRef.current = null;
      revokedSweepRef.current = new Map();
      projectsLoadBaseRef.current = new Map();
      projectsLoadTasksRef.current = new Map();
      projectsReloadOwedRef.current = false;
      projectsLoadLandedRef.current = false;
      serverScheduleTasksRef.current = new Map();
      serverProjectIdsRef.current = new Set();
      serverIdsSeededRef.current = false;
      everConfirmedProjectIdsRef.current = new Set();
      everConfirmedSeededRef.current = false;
      // The previous account's debounced syncs must not fire under the next
      // session: their rows carry A's user_id and A's data, and a queued one
      // would flush as B. The session they belonged to is already gone. One
      // already on the wire finishes on its own; it no longer counts as this
      // account's pending write.
      for (const p of syncDebounceMap.current.values()) if (p.timer) clearTimeout(p.timer);
      syncDebounceMap.current = new Map();
      inFlightProjectSyncsRef.current = new Map();
      projectsRef.current = [];
      setProjects([]);
      setProjectsLoaded(false);
      // EVERY per-account collection leaves with the account, not only
      // projects (session-load-integrity follow-up, hotfix item 4). Their
      // hydration effects (`if (xQuery.data) setX(...)`) only fire when the
      // NEXT account's rows land, so after a session expiry B's screens showed
      // A's change orders, invoices, punch items, RFIs, DFRs… until then — and
      // a batch add in that window started from A's rows in the refs below.
      // Cleared here, in the same render-phase reset, for the same reason as
      // projects: an effect would land after the first commit.
      invoicesRef.current = [];
      invoiceInsertsRef.current = new Map();
      invoicesReloadOwedRef.current = false;
      invoiceInsertOutcomesRef.current = new Map();
      changeOrderInsertsRef.current = new Map();
      punchItemsRef.current = [];
      projectPhotosRef.current = [];
      rfisRef.current = [];
      submittalsRef.current = [];
      changeOrdersRef.current = [];
      dailyReportsRef.current = [];
      aiaPayAppsRef.current = [];
      warrantiesRef.current = [];
      setChangeOrders([]); setLeads([]); setBidPackages([]); setBidPackageBids([]);
      setInvoices([]); setCommitments([]); setPrequalPackets([]); setDailyReports([]);
      setFieldTickets([]); setDelayEvents([]); setDeliveries([]); setBuildingAccessRules([]);
      setAccessReservations([]); setDeliveryReceipts([]); setSubcontractors([]); setPunchItems([]);
      setProjectPhotos([]); setPriceAlerts([]); setContacts([]); setCommEvents([]);
      setRfis([]); setSubmittals([]); setOacMeetings([]); setCois([]); setEquipment([]);
      setWarranties([]); setPermits([]); setAiaPayApps([]);
      setSubPortalLinks([]); setSubPortalLinksLoaded(false);
    } else if (projects.length === 0) {
      // Nothing from the signed-out pass to show: the new account's load is
      // "loading", not "you have no projects".
      setProjectsLoaded(false);
    }
  }

  const canSync = !!userId && isSupabaseConfigured;

  // #7: the persisted server-confirmed ids, folded into serverProjectIdsRef
  // once per account (a successful load replaces the set outright).
  const seedServerProjectIds = useCallback(async (): Promise<void> => {
    if (serverIdsSeededRef.current || !userId) return;
    let raw: string | null = null;
    try { raw = await AsyncStorage.getItem(SERVER_PROJECT_IDS_KEY); } catch { return; }
    if (liveUserIdRef.current !== userId || serverIdsSeededRef.current) return;
    for (const id of parseServerConfirmedIds(raw, userId)) serverProjectIdsRef.current.add(id);
    serverIdsSeededRef.current = true;
  }, [userId]);
  useEffect(() => { if (canSync) void seedServerProjectIds(); }, [canSync, seedServerProjectIds]);
  // #1 fix round 2: the append-only confirmed set, read once per account.
  // false = unread (storage refused / account changed): the loader then
  // records no local-only line, and nothing persists over the stored copy.
  const seedEverConfirmedProjectIds = useCallback(async (): Promise<boolean> => {
    if (everConfirmedSeededRef.current) return true;
    if (!userId) return false;
    let raw: string | null = null;
    try { raw = await AsyncStorage.getItem(EVER_CONFIRMED_PROJECT_IDS_KEY); } catch { return false; }
    if (liveUserIdRef.current !== userId) return false;
    if (everConfirmedSeededRef.current) return true;
    // Union, never replace: ids added in memory before the read are kept.
    everConfirmedProjectIdsRef.current = withServerConfirmed(everConfirmedProjectIdsRef.current, parseServerConfirmedIds(raw, userId));
    everConfirmedSeededRef.current = true;
    return true;
  }, [userId]);
  useEffect(() => { if (canSync) void seedEverConfirmedProjectIds(); }, [canSync, seedEverConfirmedProjectIds]);
  const persistEverConfirmedProjectIds = useCallback(async (): Promise<void> => {
    // Only after the stored copy was read in: before that, the in-memory set
    // is a subset and would overwrite history.
    if (!userId || !everConfirmedSeededRef.current || liveUserIdRef.current !== userId) return;
    try {
      await AsyncStorage.setItem(EVER_CONFIRMED_PROJECT_IDS_KEY, serializeServerConfirmedIds(userId, everConfirmedProjectIdsRef.current));
    } catch (err) {
      console.log('[ProjectContext] Saving ever-confirmed project ids failed:', err);
    }
  }, [userId]);
  const persistServerProjectIds = useCallback(async (): Promise<void> => {
    if (!userId || !serverIdsSeededRef.current || liveUserIdRef.current !== userId) return;
    try {
      await AsyncStorage.setItem(SERVER_PROJECT_IDS_KEY, serializeServerConfirmedIds(userId, serverProjectIdsRef.current));
    } catch (err) {
      console.log('[ProjectContext] Saving server project ids failed:', err);
    }
  }, [userId]);
  // #96 / #8 convergence: a load that kept a device row whole owes a re-read
  // once nothing for the projects is still pending — then the server copy
  // (with the edit if it landed, without it if it was refused) replaces it,
  // along with whatever else the load read. Queued writes are left to the
  // post-flush / post-discard listeners below, which re-pull on their own; a
  // direct write that lands never passes through them, so its sync's finally
  // calls this, and so does the hydration pass (a write that finished before
  // the load did).
  const settleOwedProjectsReload = useCallback(async (): Promise<void> => {
    const syncsOut = () => unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).size > 0;
    if (!projectsReloadOwedRef.current || syncsOut()) return;
    let queued: Set<string>;
    try { queued = await ownQueuedProjectIds(userId); } catch { return; }
    if (queued.size > 0) return;
    if (!projectsReloadOwedRef.current || syncsOut()) return;
    if (liveUserIdRef.current !== userId) return;
    projectsReloadOwedRef.current = false;
    await queryClient.invalidateQueries({ queryKey: ['projects', userId] });
  }, [queryClient, userId]);

  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    // Identity matters: the hydration effect runs on a new `data`, and only
    // it consumes a landed load's owed re-read (#96). Structural sharing
    // handed back the OLD array for a deep-equal load, so a load that kept a
    // row whole never raised the re-read — another device's change stayed
    // hidden until the next foreground — and its landed mark lingered into
    // the next cache write, which then fired a spare full reload.
    structuralSharing: false,
    // A load whose account signed out while it was out THROWS rather than
    // resolving []: resolved, that key held an empty "loaded" list, and a web
    // tab signing the same account back in within staleTime showed "no
    // projects" until it went stale. An error has no data and refetches on
    // the next mount. Never retried — the account is gone.
    retry: (failureCount, error) => {
      if (error instanceof StaleAccountLoadError) return false;
      if (error instanceof TypeError && error.message === 'Failed to fetch') return false;
      return failureCount < 2;
    },
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      console.log('[ProjectContext] Loading projects');
      if (canSync) {
        // Taken BEFORE the first read: a write from here on may be missing
        // from what comes back.
        const writeSeqAtStart = projectWriteLogRef.current.seq;
        const loadSeq = ++projectsLoadSeqRef.current;
        // #8: every project write not yet confirmed on the server as this load
        // STARTS — a debounced sync waiting or on the wire (the debounce map
        // plus the in-flight set: a flushed or replaced entry can be on the
        // wire with no map entry), or a queued projects / project_financials
        // write of this session's. The SELECTs below may read those rows from before the write,
        // so each keeps the whole device row (projectsLoadGuard has the rule).
        // #96: and the schedule base as it stands now, before a realtime echo
        // during the load can move it.
        const pendingAtStart = unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current);
        const baseAtStart = new Map(serverScheduleTasksRef.current);
        try {
          for (const id of await ownQueuedProjectIds(userId)) pendingAtStart.add(id);
        } catch (err) {
          console.log('[ProjectContext] Reading the offline queue before the projects load failed:', err);
        }
        // Integration round 3: AND every project under Not saved — queue
        // first, then the ledger (the order every loader keeps). A refused
        // projects / project_financials write left the device row the only
        // copy of his edit, but this loader looked at the queue alone: the
        // next foreground read put the server's stale budget back on the
        // phone, the next sync of that job (any schedule drag) re-sent it and
        // FOLDED it into the Not-saved line over his edit, and Retry then
        // landed the pre-edit money and said "synced". Kept whole now, as the
        // child lists keep theirs, until Retry lands it or Discard drops it.
        // Wave-4 final fix (round 8): a job named ONLY by the ledger is NOT
        // pinned whole. The mapper below takes the SERVER's projects row and
        // lays the line's own row over it — a project_financials line over
        // the server's fin row, a projects line over the projects row — so
        // his budget and terms show from the line (the durable copy: a
        // same-user re-auth sweep of the cache cannot hand him the server's
        // budget), every other column is the server's, and his next edit of
        // the job sends a FRESH row. Pinning it whole (round 7) sent the
        // phone's old row back on that edit — a rename, a close-out, a portal
        // switched off on the web all overwritten. His money / columns still
        // park behind the line (supabaseWrite), nothing owes a re-read (the
        // loop stays closed), and no job is dropped. Only a job the SERVER no
        // longer returns (a refused create) or one with a refused DELETE keeps
        // the device pin (below, once the SELECT has answered): there is no
        // server row to lay the line over.
        const queuePinned = new Set(pendingAtStart);
        const unsavedPins = await unsavedProjectPins(userId);
        const unsavedProjects = new Set([...unsavedPins.whole, ...unsavedPins.moneyOnly]);
        const ledgerOnlyPins = new Set([...unsavedProjects].filter((id) => !queuePinned.has(id)));
        // The ledger-only jobs whose row is taken from the server with the
        // line laid over it (a queue-pinned one keeps the device row, #8).
        const overlaidIds = new Set([...ledgerOnlyPins].filter((id) => !unsavedPins.deleted.has(id)));
        try {
          const bearerBefore = await readBearer();
          const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false });
          // Money lives in project_financials, off the projects row, so a
          // 'field' collaborator can read the schedule without reading the
          // margin (RLS is row-level and can't blind columns —
          // 20260826140000_project_financials_split.sql). RLS returns ZERO rows
          // here for a field user, which is the point: their projects simply
          // arrive with no estimate. Failure is non-fatal — we fall back to the
          // legacy columns, which still exist until the phase-2 drop.
          //
          // B-1: this SELECT never throws — it returns `{ error }` — and an
          // error used to look exactly like "no rows", so a transient failure
          // handed every shared project `estimate: null`, which the device
          // cache kept and the collaborator's next PATCH carried into BOTH
          // tables. `finReadOk` is false on either failure mode; the mapper
          // then keeps the cached money and stamps financialsLoaded: false so
          // no write carries it until a read succeeds.
          const finById = new Map<string, Record<string, unknown>>();
          let finReadOk = false;
          try {
            const { data: fin, error: finError } = await supabase.from('project_financials').select('*');
            if (finError) {
              console.log('[ProjectContext] project_financials read failed — keeping cached money, holding it back from writes:', finError.message);
            } else {
              finReadOk = true;
              for (const f of (fin ?? []) as Record<string, unknown>[]) {
                finById.set(f.project_id as string, f);
              }
            }
          } catch {
            // table not created yet (pre-migration) — legacy columns cover us
          }
          // B-2: the caller's role on each shared project, from the table the
          // invite flow actually writes (project-invite → project_collaborators;
          // the display `collaborators` roster is never touched by it, so it
          // could not tell a field foreman from an editor). Own rows only —
          // pc_invitee_read. A failed read keeps the cached stamp: it must
          // never downgrade a shared project to owned.
          const roleById = new Map<string, ProjectCollaborator['role']>();
          let rolesReadOk = false;
          try {
            const { data: pcRows, error: pcError } = await supabase
              .from('project_collaborators')
              .select('project_id, role, status')
              .eq('user_id', userId);
            if (pcError) {
              console.log('[ProjectContext] project_collaborators read failed — keeping cached roles:', pcError.message);
            } else {
              rolesReadOk = true;
              for (const [pid, role] of acceptedRolesByProject(pcRows as CollaboratorRowLike[] | null)) roleById.set(pid, role);
            }
          } catch {
            // table absent (pre-migration) — cached roles / display list cover us
          }
          // #90: a successful read is the server's answer even with ZERO rows
          // (his only job was the one he was removed from) — but only when it
          // was answered to his live bearer (emptyReadTrusted); an anon answer
          // falls through to the device copy as before.
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            // The device copy: local-only rows to merge back in below, and the
            // per-project stamps (myRole, money) to keep when a read failed.
            const localForMerge = await loadLocal<Project[]>(PROJECTS_KEY, []);
            const localById = new Map(localForMerge.map((p) => [p.id, p] as const));
            // Contract terms (mode / GMP cap / fee / retainage) keep the device
            // copy while that project's own write is still queued — the SELECT
            // above returns the server's OLD value until the flush lands, and
            // taking it silently undid an offline edit. Read once per load.
            // Round 8: a job under Not saved takes its terms from the fin
            // row with the line laid over it (below), not from the cache —
            // only one whose write is still QUEUED keeps the cached terms.
            const pendingProjectIds = new Set([...await queuedIdsFor('projects'), ...[...unsavedProjects].filter((id) => queuePinned.has(id))]);
            const mapped = data.map((serverRow: Record<string, unknown>) => {
              const rid = serverRow.id as string;
              const overlaid = overlaidIds.has(rid);
              // Round 8: the server's rows with his Not-saved line laid over
              // them (overlayUnsavedRow). A fin line over a FAILED fin read
              // lays over nothing: an owner then shows the line's money (not
              // the legacy column's server value, which his next edit would
              // fold over the line); a shared job still takes the cache and
              // stays out of writes (hasRow reads the SERVER's answer, B-1).
              const r = overlaid ? overlayUnsavedRow(serverRow, unsavedPins.projectRows.get(rid)) as Record<string, unknown> : serverRow;
              const fServer = finById.get(rid);
              const f = overlaid ? overlayUnsavedRow(fServer, unsavedPins.finRows.get(rid)) : fServer;
              const owned = r.user_id === userId;
              const cached = localById.get(r.id as string);
              const myRole = myRoleAfterLoad(rolesReadOk, roleById.get(r.id as string), cached?.myRole);
              // B-3: the legacy columns still carry money for every project
              // estimated on the pre-split build since the backfill (devices
              // write projects.* only until the OTA lands). No fin row + legacy
              // money = the fin table is provably behind, NOT "no estimate
              // exists": an editor stamped "loaded" there sent `estimate: null`
              // over the owner's estimate on its next PATCH.
              const legacyHasMoney = legacyMoneyPresent(serverRow);
              // Prefer the new table; fall back to the legacy column so this
              // build is correct both before and after the phase-2 drop —
              // AUTH-F2: for the OWNER, and (B-3 companion) for DISPLAY to a
              // known non-field server role read fresh on THIS load — never a
              // cached role, so a foreman demoted since the last load is not
              // handed the estimate on a launch whose roles read failed. Any
              // other collaborator whose role could not read project_financials
              // must not get the legacy estimate.
              // B-1: after a FAILED financials read a shared project keeps the
              // money it last loaded (display only — financialsLoaded keeps it
              // out of every write) instead of `undefined`.
              const displayRole = rolesReadOk ? myRole : undefined;
              const pick = (key: string, legacy: unknown, cachedValue: unknown) =>
                financialPickAfterLoad(f, key, legacy, owned, finReadOk, cachedValue, displayRole);
              return ({
              id: r.id as string, name: r.name as string, type: r.type as string,
              // Who the row belongs to. Persisted with the local copy so the
              // write path (classifyProjectForSync) knows a shared project from
              // an owned one on an OFFLINE launch too — the old in-memory
              // "shared ids" set was empty until a server load succeeded.
              ownerUserId: (r.user_id as string | null) ?? undefined,
              myRole,
              financialsLoaded: financialsLoadedFor({ owned, hasRow: !!fServer, readSucceeded: finReadOk, myRole, legacyHasMoney }),
              location: (r.location as string) ?? '', squareFootage: Number(r.square_footage) || 0,
              quality: (r.quality as string) ?? 'standard', description: (r.description as string) ?? '',
              locationLatitude: r.location_latitude != null ? Number(r.location_latitude) : undefined,
              locationLongitude: r.location_longitude != null ? Number(r.location_longitude) : undefined,
              locationGeocodedAt: (r.location_geocoded_at as string | null) ?? undefined,
              // THE ZONING CONFIRM IS DEVICE-LOCAL, AND THIS LINE IS WHY IT
              // SURVIVES AT ALL. `projects` has no structured_address column, so
              // structuredAddress is in neither the upsert payload below nor
              // this mapper's inputs — and without carrying the device's cached
              // copy forward, `saveLocal(PROJECTS_KEY, merged)` a few lines down
              // overwrote it with undefined and DESTROYED every zoning confirm
              // on the next successful fetch. (The first version of that fix
              // claimed "no DB mapping exists … so it persists with no
              // migration". No mapping means the opposite: it is wiped.)
              // Deliberately device-scoped, not synced: a real fix is a column +
              // payload + mapper + migration, which this pass did not take on.
              // The gate still re-checks the confirm against the CURRENT
              // (server-synced) location, so a carried confirm cannot outlive
              // an address change made on another device — it reads stale.
              structuredAddress: cached?.structuredAddress,
              // Wave 5 (portfolio): the public project page's headline, story,
              // testimonial, slug and switch are device-kept the same way
              // (projects has no column for them; the page's on/off truth is
              // public_profiles, read on open). Without this every successful
              // fetch wiped what he typed.
              publicProfile: cached?.publicProfile,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              estimate: (pick('estimate', r.estimate, cached?.estimate) ?? null) as Project['estimate'],
              schedule: r.schedule as Project['schedule'],
              linkedEstimate: pick('linked_estimate', r.linked_estimate, cached?.linkedEstimate) as Project['linkedEstimate'],
              estimateVersions: pick('estimate_versions', r.estimate_versions, cached?.estimateVersions) as Project['estimateVersions'],
              status: (r.status as Project['status']) ?? 'draft',
              collaborators: r.collaborators as ProjectCollaborator[] ?? [],
              scope: (r.scope ?? undefined) as Project['scope'],
              // AUTH-F5: the portal token + passcode authenticate the HOMEOWNER;
              // they never reach a collaborator's memory or AsyncStorage cache.
              clientPortal: (owned
                ? r.client_portal
                : stripPortalCredentials(r.client_portal as Project['clientPortal'] | null)) as Project['clientPortal'],
              targetBudget: pick('target_budget', r.target_budget, cached?.targetBudget) as Project['targetBudget'],
              // Contract terms live on project_financials only (no legacy copy on
              // projects to fall back to — 20260917110000_project_contract_terms
              // .sql). Before that migration nothing mapped them and every fetch
              // wiped retainagePercent and any seeded contractMode. The rules for
              // server-vs-cached and the `contractTermsLoaded` stamp that gates
              // NULL writes are in types/index.ts contractTermsAfterLoad.
              // canViewMoney uses the cached role on purpose when the roles read
              // failed: it only decides whether a device KEEPS its own copy when
              // no row came back, never whether to hand out a server value.
              ...contractTermsAfterLoad({
                finRow: f,
                readSucceeded: finReadOk,
                canViewMoney: owned || (myRole != null && !isFinancialsBlinded(myRole)),
                writePending: pendingProjectIds.has(r.id as string),
                cached,
              }),
              primaryContact: (r.primary_contact as Project['primaryContact']) ?? undefined,
              leadSource: (r.lead_source as string | null) ?? undefined,
              targetTimelineNotes: (r.target_timeline_notes as string | null) ?? undefined,
              handoverChecklist: (r.handover_checklist as Record<string, string> | null) ?? {},
              closedAt: r.closed_at as string | undefined,
              substantialCompletionDate: r.substantial_completion_date as string | undefined,
              warrantyWalkCompletedAt: r.warranty_walk_completed_at as string | undefined,
              photoCount: Number(r.photo_count) || 0,
            });
            }) as Project[];
            // Merge in any local-only projects the server doesn't have yet — a
            // just-created project whose async Supabase upsert hasn't committed,
            // or an offline-created one. A server-first load must NEVER silently
            // drop them (that's what made the demo seeder's project — and any
            // offline-created project — vanish on the next reload).
            const remoteIds = new Set(mapped.map((p) => p.id));
            // Round 8: the Not-saved jobs with no server row to lay the line
            // over — a refused create the server never got, or a refused
            // DELETE — keep the device's copy (or its absence) whole, as the
            // queue's pins do. They still owe no re-read (ledgerOnlyPins).
            for (const id of ledgerOnlyPins) if (!overlaidIds.has(id) || !remoteIds.has(id)) pendingAtStart.add(id);
            // #6: a load started under the account that has since signed out
            // must leave nothing behind — no refs, no device cache.
            if (liveUserIdRef.current !== userId) throw new StaleAccountLoadError();
            // A project written while these reads were out keeps the device
            // copy (utils/projectsLoadGuard) — here, so the cache is not
            // overwritten with the pre-edit row either, and again where
            // `projects` takes the result, for a write in between. One still
            // unconfirmed when the load began keeps it whole (#8); one only
            // edited during the load takes in the server's schedule (#96).
            // Review round 2: until this account's list has hydrated, the
            // in-memory list is not the device's (on a cold launch it is
            // still []) — plan against the device cache as well, or every
            // project with a queued write reads as deleted here and vanishes.
            const planLocal = projectsHydratedForRef.current === userId
              ? projectsRef.current
              : withDeviceCopies(projectsRef.current, localForMerge, projectWriteLogRef.current, writeSeqAtStart);
            // #90: a cached job the server no longer returns and that is
            // someone else's (known owner ≠ him, or a stamped collaborator
            // role) is a job he was REMOVED from — it leaves this phone,
            // whatever the device copy or a queued write says. His own
            // unsynced creates (no owner stamp, no role) are kept below.
            let revoked = revokedCachedProjectIds([...localForMerge, ...projectsRef.current], remoteIds, userId);
            if (revoked.size > 0 && !revocationConfirmed({ rowCount: data.length, confirmedEmpty: data.length === 0 && await confirmNoProjects(userId) })) {
              revoked = new Set();
            }
            // A job the server returns again (he was re-invited) is no longer
            // swept from the child lists.
            for (const id of remoteIds) revokedSweepRef.current.delete(id);
            const plan = planProjectsLoad(
              [...mapped, ...localForMerge.filter((p) => !remoteIds.has(p.id) && !revoked.has(p.id))],
              planLocal, projectWriteLogRef.current, writeSeqAtStart,
              { pending: pendingAtStart, fold: foldServerSchedule<Project>(baseAtStart) },
            );
            const merged = revoked.size > 0 ? plan.projects.filter((p) => !revoked.has(p.id)) : plan.projects;
            // For the hydration pass (same filter — its planner can re-add a
            // row with a pending write from memory) and the one-time cleanup.
            projectsLoadRevokedRef.current = revoked;
            if (revoked.size > 0) {
              const names = new Map<string, string>();
              for (const p of [...projectsRef.current, ...localForMerge]) if (revoked.has(p.id) && !names.has(p.id)) names.set(p.id, p.name ?? '');
              revokedCleanupOwedRef.current = { userId, names };
            }
            // #1 (wave 5, CONTRACT 21): his jobs that exist only on this phone —
            // never confirmed on the server, nothing queued, on the wire or
            // under Not saved — were merged back in above and then nothing
            // ever sent them (the creates the old free-plan cap refused, or a
            // flush dropped before the ledger existed): no badge, no Retry.
            // Each becomes a Not-saved line with its INSERT (Retry / Discard);
            // never resent on its own. A job that WAS on the server and is
            // gone now (deleted on the web or a second phone) is never offered
            // for re-creation, on this load or any later one (fix round 2):
            // `confirmedBefore` is the APPEND-ONLY ever-confirmed set plus the
            // replace-on-load set as it stood before this read — the latter
            // alone forgot the job one load later, while the loader kept his
            // copy — and the selector also skips a device copy carrying the
            // loader's stamp (read from the server at some load). If the
            // append-only set could not be read, nothing is recorded.
            await seedServerProjectIds();
            const everSeeded = await seedEverConfirmedProjectIds();
            if (liveUserIdRef.current !== userId) throw new StaleAccountLoadError();
            const confirmedBefore = withServerConfirmed(everConfirmedProjectIdsRef.current, serverProjectIdsRef.current);
            if (userId) {
              // Fix round 1: the exclusions are rebuilt NOW, after the SELECT
              // answered — not taken from pendingAtStart / unsavedProjects,
              // which were captured before it went out. A job created,
              // queued, put on the wire or refused (failDirectWrite's own
              // line) while the SELECT was out is absent from the answer only
              // because the read predates it; a local-only line for it would
              // park its own queued create behind itself (parkBehindUnsaved-
              // Write keys on table + recordId) and lay a stale insert row
              // over the server's. Queue first, then the ledger, as every
              // loader reads them. Either read refused → record nothing this
              // load (the job stays on the phone; the next load asks again).
              let recordNow: { pending: Set<string>; unsaved: Set<string>; lineIds: Set<string> } | null = null;
              try {
                const pendingNow = unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current);
                for (const id of pendingAtStart) pendingNow.add(id);
                for (const id of await ownQueuedProjectIds(userId)) pendingNow.add(id);
                const queuedNow = await queuedIdsFor('projects');
                const ownNow = ownFailures(await readSyncFailuresOrThrow(), userId);
                const pinsNow = unsavedProjectPinsIn(ownNow, queuedNow);
                const unsavedNow = new Set([...unsavedProjects, ...pinsNow.whole, ...pinsNow.moneyOnly, ...pinsNow.deleted]);
                // Any own line naming the job (an rpc-only projects line too).
                for (const f of ownNow) if ((f.table === 'projects' || f.table === 'project_financials') && f.recordId) unsavedNow.add(f.recordId);
                recordNow = { pending: pendingNow, unsaved: unsavedNow, lineIds: new Set(ownNow.map((f) => f.id)) };
              } catch (err) {
                console.log('[ProjectContext] Re-reading the queue / Not saved before recording local-only jobs failed:', err);
              }
              if (liveUserIdRef.current !== userId) throw new StaleAccountLoadError();
              // Self-heal: a local-only line whose job the server DID return
              // (its create landed after all — e.g. a line an older build
              // recorded while that create was on the wire) is stale. It only
              // parks the job's edits and lays an old insert row over the
              // server's, so it is cleared. Acknowledged, not discarded: the
              // Discard listener removes the job from the phone, and the job
              // is safely on the server. Only the local-only line itself goes;
              // any edit parked behind it stays under Not saved with Retry.
              if (recordNow) {
                const stale = [...remoteIds].filter((pid) => !isRecordRetrying('projects', pid)).map(localOnlyProjectLineId).filter((lid) => recordNow!.lineIds.has(lid));
                if (stale.length > 0) {
                  await acknowledgeSyncFailures(stale);
                  console.log('[ProjectContext] Cleared local-only lines for jobs the server now has:', stale.length);
                }
              }
              const writtenDuringLoad = new Set<string>();
              for (const [id, seq] of projectWriteLogRef.current.byId) if (seq > writeSeqAtStart) writtenDuringLoad.add(id);
              const localOnly = recordNow && everSeeded ? localOnlyOwnedProjectIds({
                local: merged, remoteIds, userId, confirmedBefore,
                pending: recordNow.pending, unsaved: recordNow.unsaved, revoked,
                written: writtenDuringLoad,
              }) : [];
              if (localOnly.length > 0) {
                const byId = new Map(merged.map((p) => [p.id, p] as const));
                const at = Date.now();
                try {
                  await recordSyncFailures(localOnly.map((pid) => {
                    const p = byId.get(pid)!;
                    const madeAt = Date.parse(p.createdAt);
                    return {
                      id: localOnlyProjectLineId(pid),
                      kind: 'write' as const,
                      label: labelForWrite('projects'),
                      reason: LOCAL_ONLY_PROJECT_REASON,
                      at,
                      userId,
                      table: 'projects',
                      recordId: pid,
                      operation: 'insert' as const,
                      row: localOnlyProjectInsertRow(p, userId),
                      queuedAt: Number.isFinite(madeAt) ? madeAt : at,
                    };
                  }));
                  console.log('[ProjectContext] Jobs only on this phone, now under Not saved:', localOnly.length);
                } catch (err) {
                  console.log('[ProjectContext] Recording local-only jobs under Not saved failed:', err);
                }
              }
            }
            // Fix round 2: the append-only set takes in the old confirmed set
            // and this answer BEFORE the replace-on-load set forgets anything.
            everConfirmedProjectIdsRef.current = withServerConfirmed(
              withServerConfirmed(everConfirmedProjectIdsRef.current, serverProjectIdsRef.current), remoteIds);
            serverProjectIdsRef.current = new Set(remoteIds);
            serverIdsSeededRef.current = true;
            void persistServerProjectIds();
            void persistEverConfirmedProjectIds();
            // #96: the base advances only where the device copy took the
            // server's tasks. For a row kept whole it stays behind, or the
            // next realtime echo would read the server's unseen value (the
            // foreman's 60%) as this device's edit back to the old one.
            // Review round 1: but only where a base EXISTS. With none (the
            // launch's first load, or the first after an account switch)
            // the next realtime absorb falls back to the device copy as its
            // base, reads every non-field key as "the server changed it", and
            // reverts his unconfirmed date move in memory and in the cache.
            // The SELECT is the base the shipped loader used; field keys are
            // settled by their stamps either way.
            // Round 8: the SERVER's tasks, never a Not-saved line's schedule
            // laid over the mapped row — the base is what the server holds.
            const selectedTasks = new Map<string, ScheduleTask[]>();
            for (const r of data as Record<string, unknown>[]) {
              selectedTasks.set(r.id as string, ((r.schedule as Project['schedule'] | null)?.tasks ?? []) as ScheduleTask[]);
            }
            const loadedTasks = new Map<string, ScheduleTask[]>();
            for (const p of mapped) {
              if (plan.keptWhole.has(p.id) && serverScheduleTasksRef.current.has(p.id)) continue;
              const serverTasks = selectedTasks.get(p.id) ?? [];
              serverScheduleTasksRef.current.set(p.id, serverTasks);
              if (!pendingAtStart.has(p.id)) loadedTasks.set(p.id, serverTasks);
            }
            projectsLoadSinceRef.current = writeSeqAtStart;
            projectsLoadPendingRef.current = pendingAtStart;
            projectsLoadLedgerOnlyRef.current = ledgerOnlyPins;
            projectsLoadBaseRef.current = baseAtStart;
            projectsLoadTasksRef.current = loadedTasks;
            // The hydration pass sets the owed flag from what it keeps — only
            // for the newest load started (a superseded one is never shown).
            if (loadSeq === projectsLoadSeqRef.current) projectsLoadLandedRef.current = true;
            notePortalRead('projects', userId, true, readEpoch); // #23: the server's list
            await saveLocal(PROJECTS_KEY, merged);
            return merged;
          }
        } catch (err) {
          if (err instanceof StaleAccountLoadError) throw err;
          console.log('[ProjectContext] Supabase fetch failed, falling back to local:', err);
        }
        // #7: the device copy, with what this account last knew the server
        // holds — a status change on this launch must not re-send the cached
        // schedule over another device's work.
        await seedServerProjectIds();
      }
      // Review round 1: signed out, remember whose device copy this is (the
      // last-user marker), so the next sign-in can tell its own list from
      // another account's (the render-phase reset above).
      let cacheOwner: string | null = null;
      if (!userId) {
        try { cacheOwner = await AsyncStorage.getItem(LAST_USER_MARKER_KEY); } catch { cacheOwner = null; }
      }
      notePortalRead('projects', userId, false, readEpoch); // #23: the device cache, not the server's
      const cached = await loadLocal<Project[]>(PROJECTS_KEY, []);
      // #6: nothing read for an account that is no longer signed in.
      if (liveUserIdRef.current !== userId) throw new StaleAccountLoadError();
      if (!userId) signedOutCacheOwnerRef.current = cacheOwner;
      return cached;
    },
  });

  // Runs the re-read a raced settings load owed, once nothing this device
  // wrote is still out (utils/settingsLoadGuard owedSettingsRereadReady).
  // Called as the load returns, and as each whole-row or terms write settles
  // — a write that settled while the read was still out, or a terms-only
  // race, has no later event that would run it (review round 2).
  const runOwedSettingsReread = useCallback(async (uid: string) => {
    if (!settingsRereadOwedRef.current || liveUserIdRef.current !== uid) return;
    const queue = await getOfflineQueue();
    const termsQueued = termsWritesPending(queue, uid);
    const ready = owedSettingsRereadReady({
      owed: settingsRereadOwedRef.current,
      rowWritesInFlight: settingsRowWritesInFlightRef.current,
      termsWritesInFlight: termsWritesInFlightRef.current,
      profilesWriteQueued: settingsRowWritePending(queue, uid) || termsQueued.split || termsQueued.warranty,
    });
    if (!ready || liveUserIdRef.current !== uid) return;
    settingsRereadOwedRef.current = false;
    void queryClient.invalidateQueries({ queryKey: ['settings', uid] });
  }, [queryClient]);

  const settingsQuery = useQuery({
    queryKey: ['settings', userId],
    // Identity matters here: settingsDataSeqRef is keyed by the object this
    // queryFn returned, and structural sharing would swap in an older,
    // deep-equal one.
    structuralSharing: false,
    queryFn: async ({ signal }) => {
      console.log('[ProjectContext] Loading settings');
      const ownerKey = userId ?? 'signed-out';
      const loadedNow = () => (settingsLoadedForRef.current === ownerKey ? settingsRef.current : null);
      // Tag what we hand React Query with the write sequence it was built at
      // (see the data effect): a result with no tag is never committed.
      const handOver = (s: AppSettings): AppSettings => {
        settingsDataSeqRef.current.set(s, settingsWriteSeqRef.current);
        return s;
      };
      const priorFirstReadFailures = settingsFirstReadFailuresRef.current.owner === ownerKey
        ? settingsFirstReadFailuresRef.current.n : 0;
      if (canSync) {
        // A FIRST read — nothing loaded, no device copy — blocks every client
        // document until it lands, so it is bounded (finding 105): a stall
        // aborts, counts as a failure, and the gate says so with a Retry.
        // The deadline doubles with each failed first read for this account
        // (firstProfileReadTimeoutMs): it covers the body too, and his row
        // can be ~235 KB, so a fixed 15 s could never land on a slow link.
        // React Query's own signal is forwarded so a CANCEL aborts the
        // request. Note an invalidate alone does not cancel a query that has
        // no data yet — it joins the running retry cycle — which is why
        // retryRemoteReads cancels this query first while it is unloaded.
        const hadCopy = !!loadedNow() || !!(await loadLocal<AppSettings | null>(SETTINGS_KEY, null));
        const abort = new AbortController();
        const onCancel = () => abort.abort();
        if (signal?.aborted) abort.abort();
        else signal?.addEventListener?.('abort', onCancel);
        const timer = hadCopy ? null : setTimeout(() => abort.abort(), firstProfileReadTimeoutMs(priorFirstReadFailures));
        try {
          const termsEpochAtRead = termsWriteEpochRef.current;
          const termsInFlightAtRead = termsWritesInFlightRef.current;
          const writeSeqAtRead = settingsWriteSeqRef.current;
          const rowInFlightAtRead = settingsRowWritesInFlightRef.current;
          // An error here — "no row" (PGRST116) included — is a failed read,
          // never "a new account with blank settings": see settingsReadFallback.
          const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).abortSignal(abort.signal).single();
          if (!error && data) {
            // Payment terms: the server's answer wins only where it can vouch
            // for one — the columns exist (20260917150000 applied) and no terms
            // write is still queued. Otherwise the device's answer is kept;
            // dropping it would ask the GC a question he already answered.
            const cachedSettings = await loadLocal<AppSettings | null>(SETTINGS_KEY, null);
            const termsInFlight = termsInFlightAtRead > 0
              || termsWritesInFlightRef.current > 0
              || termsWriteEpochRef.current !== termsEpochAtRead;
            // Integration round 3: the queue, THEN this session's Not-saved
            // profile lines — a refused terms save is still his answer.
            const termsQueue = await getOfflineQueue();
            const termsPending = pendingWithInFlight(termsWritesPending([...termsQueue, ...await unsavedAsQueueEntries('profiles')], userId), termsInFlight);
            // Round 8: the settings columns come from the row with his
            // Not-saved settings save laid over it (settingsRowWithUnsaved;
            // read after the queue, like the guards) — wherever the row wins
            // below (a cold launch, a swept cache), his refused edit still
            // shows. Payment terms keep their own rule (paymentTermsAfterLoad).
            const row = settingsRowWithUnsaved(data as Record<string, unknown>, await unsavedAsQueueEntries('profiles'), userId);
            const s: AppSettings = {
              location: (row.location as string) ?? 'United States',
              units: ((row.units as string) ?? 'imperial') as 'imperial' | 'metric',
              // MONEY-F3: `Number(x) || 7.5` turned a saved 0 % back into 7.5 % on
              // every synced load (and saveLocal below then overwrote the device
              // copy too). Only a MISSING value falls back.
              taxRate: coerceRate(row.tax_rate, DEFAULT_SETTINGS.taxRate),
              contingencyRate: coerceRate(row.contingency_rate, DEFAULT_SETTINGS.contingencyRate),
              branding: {
                companyName: (row.company_name as string) ?? '', contactName: (row.contact_name as string) ?? '',
                email: (row.email as string) ?? '', phone: (row.phone as string) ?? '',
                address: (row.address as string) ?? '', licenseNumber: (row.license_number as string) ?? '',
                // Own columns since 20260917120000 — the licensing state used
                // to be inferred from the pricing market (location). Blank
                // when unset; bidDocumentIdentity then falls back to address,
                // then market. Normalised on read too, so a hand-edited row
                // cannot feed the gate a state it would not accept on write.
                licenseState: licenceStateColumnValue(row.license_state as string | null) ?? '',
                licenseExpiry: licenceExpiryColumnValue(row.license_expiry as string | null) ?? '',
                tagline: (row.tagline as string) ?? '', logoUri: row.logo_uri as string | undefined,
                signatureData: row.signature_data as string[] | undefined,
              },
              themeColors: row.theme_colors as AppSettings['themeColors'],
              biometricsEnabled: row.biometrics_enabled as boolean,
              dfrRecipients: row.dfr_recipients as string[],
              digest: {
                enabled: !!row.digest_enabled,
                hour: (row.digest_hour as number | null) ?? 6,
                timezone: (row.digest_timezone as string | null) ?? 'America/New_York',
                channels: ((row.digest_channels as { email?: boolean; in_app?: boolean } | null) ?? { email: true, in_app: true }) as { email: boolean; in_app: boolean },
              },
              financing: row.financing as AppSettings['financing'],
              ...paymentTermsAfterLoad({ row: data as Record<string, unknown>, cached: cachedSettings, pending: termsPending }),
            };
            // Finding 15: a settings write made on this device while the read
            // was out (or still on the wire / queued) is newer than this row.
            // Integration round 3: queued OR under Not saved (queue first) — a
            // refused whole-row save left the device's settings the only copy;
            // taking the row here reverted them, and the next save folded the
            // reverted values into the Not-saved line over his edit.
            // Wave-4 final fix: the two kept APART. A queued save owes a
            // re-read once it lands; a Not-saved one keeps the device copy
            // and owes none — Retry / Discard re-read (settingsAfterRead).
            const rowQueue = await getOfflineQueue();
            const rowQueued = settingsRowWritePending(rowQueue, userId);
            const rowUnsaved = settingsRowWritePending(await unsavedAsQueueEntries('profiles'), userId);
            const afterRead = () => settingsAfterRead({
              fromRow: s,
              current: settingsRef.current,
              currentLoaded: settingsLoadedForRef.current === ownerKey,
              writeSeqAtStart: writeSeqAtRead,
              writeSeqNow: settingsWriteSeqRef.current,
              rowWritesInFlightAtStart: rowInFlightAtRead,
              rowWritesInFlightNow: settingsRowWritesInFlightRef.current,
              rowWriteQueued: rowQueued,
              rowWriteUnsaved: rowUnsaved,
            });
            let outcome = afterRead();
            if (outcome.persist) {
              await saveLocal(SETTINGS_KEY, s);
              // A write that started during that save saved its own copy;
              // re-check so this row is not handed over on top of it.
              outcome = afterRead();
              if (!outcome.persist) await saveLocal(SETTINGS_KEY, settingsRef.current);
            }
            // Round 8 (settings twin): the device copy kept for a Not-saved
            // save is never saved over — but when a same-user re-auth sweep
            // has already REMOVED the device copy, nothing else writes it
            // back. Put the kept copy there so the next launch starts from it.
            if (outcome.kept === 'device' && !outcome.persist && !outcome.rereadOwed
              && !(await loadLocal<AppSettings | null>(SETTINGS_KEY, null))) {
              await saveLocal(SETTINGS_KEY, outcome.settings);
            }
            settingsRereadOwedRef.current = outcome.rereadOwed;
            // After this result is handed over (a macrotask later): an
            // invalidate while this fetch is still running would cancel it.
            if (outcome.rereadOwed) {
              const owedFor = userId;
              setTimeout(() => { void runOwedSettingsReread(owedFor); }, 0);
            }
            settingsFirstReadFailuresRef.current = { owner: ownerKey, n: 0 };
            return handOver(outcome.settings);
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase settings fetch failed:', err);
        } finally {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener?.('abort', onCancel);
        }
      }
      // No row. Finding 13: DEFAULT is his profile only when there is no
      // server; a failed read — "no row" included — with no device copy
      // THROWS, so settingsLoaded stays false, React Query retries, and the
      // gate offers Retry instead of asking again what he told us long ago
      // and saving blanks over his row.
      const fallback = settingsReadFallback({
        canSync,
        loaded: loadedNow(),
        cached: await loadLocal<AppSettings | null>(SETTINGS_KEY, null),
        defaults: DEFAULT_SETTINGS,
      });
      if ('fail' in fallback) {
        // A cancel (Retry, unmount) is not the link failing: it does not
        // lengthen the next deadline.
        if (!signal?.aborted) {
          settingsFirstReadFailuresRef.current = { owner: ownerKey, n: priorFirstReadFailures + 1 };
        }
        throw new Error(fallback.fail);
      }
      return handOver(fallback.resolve);
    },
  });
  // Finding 13 + 105: the first read failed (or timed out) and this account
  // has nothing loaded. The gate and the profile screens say so, with Retry,
  // instead of "One second" for as long as the signal is gone. failureCount
  // rises on the FIRST failed attempt, so this does not wait out React
  // Query's retries.
  const settingsLoadFailed = settingsQuery.isError || settingsQuery.failureCount > 0;
  // Whether the settings read may still hold the cold-start splash: only
  // until its first attempt for this account has settled (settingsHoldsBoot).
  // Sticky per account — see the rule for why raw isLoading re-raised the
  // CraneLoader over the whole app on every Retry once the read could fail.
  const [settingsBootSettledFor, setSettingsBootSettledFor] = useState<string | null>(null);
  useEffect(() => {
    if (settingsQuery.data !== undefined || settingsQuery.failureCount > 0 || settingsQuery.isError) {
      setSettingsBootSettledFor(settingsOwnerKey);
    }
  }, [settingsQuery.data, settingsQuery.failureCount, settingsQuery.isError, settingsOwnerKey]);
  const settingsBootLoading = settingsHoldsBoot({
    isLoading: settingsQuery.isLoading,
    settledForOwner: settingsBootSettledFor === settingsOwnerKey,
  });

  const changeOrdersQuery = useQuery({
    queryKey: ['changeOrders', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          const coReadStartedAt = Date.now();
          const bearerBefore = await readBearer();
          const { data, error } = await supabase.from('change_orders').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              date: r.date as string, description: (r.description as string) ?? '',
              reason: (r.reason as string) ?? '', lineItems: r.line_items as ChangeOrder['lineItems'],
              originalContractValue: Number(r.original_contract_value), changeAmount: Number(r.change_amount),
              newContractTotal: Number(r.new_contract_total), status: r.status as ChangeOrder['status'],
              approvers: r.approvers as ChangeOrder['approvers'], approvalMode: r.approval_mode as ChangeOrder['approvalMode'],
              approvalDeadlineDays: r.approval_deadline_days as number | undefined,
              auditTrail: r.audit_trail as ChangeOrder['auditTrail'], revision: Number(r.revision) || 1,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // portal_state MUST be read back. It is written on insert and on every
              // send/recall, but was hydrated ONLY by the invoices mapper — so a refetch
              // stripped it here, saveLocal destroyed the local copy, and
              // portalSnapshot.isShared() treats undefined as SENT (grandfathering
              // pre-portal records). Net effect: unsent DRAFTS and explicitly RECALLED
              // items became client-visible on the next project open.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
              // The days a CO adds to the schedule is the contractual
              // time-extension claim; losing it on refetch means the reflow
              // silently re-applies or the entitlement is gone.
              scheduleImpactDays: r.schedule_impact_days == null ? undefined : Number(r.schedule_impact_days),
              scheduleImpactApplied: r.schedule_impact_applied == null ? undefined : Boolean(r.schedule_impact_applied),
              // The two anchor columns were written by NOTHING and read by
              // NOTHING before this — migration 20260803150000 added them so
              // "the anchor survives a device swap" and then no code ever
              // touched them. Without them a second device forgets which task
              // the GC picked to absorb the days and asks them to place the
              // extension again (or silently re-derives a different anchor).
              scheduleImpactTaskIds: (r.schedule_impact_task_ids as string[] | null) ?? undefined,
              scheduleAnchorTaskId: (r.schedule_anchor_task_id as string | null) ?? undefined,
              // #131: the sales tax frozen on send — the figure the client
              // approved. Absent on a CO that predates the freeze.
              ...changeOrderTaxFromRow(r),
              // #73: read back what changeOrderToRow writes.
              revisesChangeOrderId: (r.revises_change_order_id as string | null) ?? undefined,
            })) as ChangeOrder[];
            // #77/#141: every row the SERVER returned has landed, so its number
            // is the server's — seed the CO screen's confirmed-number memory
            // (Share PDF / the mail-app fallback then work offline on site).
            // The mapped server rows only: a queued insert's number in the
            // device copy is a proposal, not a fact.
            rememberServerChangeOrderNumbers(mapped.map(c => ({ id: c.id, number: c.number })));
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // Device copy kept for ids with a queued write (SYNC-F3, #48) AND
            // for ids this device wrote while this read was out: realtime
            // re-reads on the echo of its own edit, and a read answered before
            // that edit landed would put the pre-edit row back on an open CO.
            const keepDevice = new Set([...await queuedIdsFor('change_orders'), ...await unsavedWriteIds('change_orders'), ...coIdsWrittenDuringRead(coWriteTouchRef.current, coReadStartedAt)]);
            const kept = mergeServerKeepingPending(mapped, await loadLocal<ChangeOrder[]>(CHANGE_ORDERS_KEY, []), keepDevice, { deletedIds: await queuedDeletesFor('change_orders') });
            // #40: the entries still owed to co_append_audit stay on screen
            // (the server row lacks them until the append lands).
            await coAuditLoadRef.current;
            const merged = overlayPendingAudit(kept, pendingCoAuditRef.current);
            notePortalRead('changeOrders', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, CHANGE_ORDERS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('changeOrders', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<ChangeOrder[]>(CHANGE_ORDERS_KEY, []);
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoices', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          // #5 (wave 4): readStartedAt is taken BEFORE the SELECT — a write
          // that settles after it may be missing from what comes back.
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              type: r.type as Invoice['type'], progressPercent: r.progress_percent as number | undefined,
              issueDate: r.issue_date as string, dueDate: r.due_date as string,
              paymentTerms: r.payment_terms as Invoice['paymentTerms'], notes: (r.notes as string) ?? '',
              lineItems: r.line_items as Invoice['lineItems'], subtotal: Number(r.subtotal),
              taxRate: Number(r.tax_rate), taxAmount: Number(r.tax_amount), totalDue: Number(r.total_due),
              amountPaid: Number(r.amount_paid), status: r.status as Invoice['status'],
              payments: r.payments as Invoice['payments'], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // Hydrate every persisted field the mapper used to drop — otherwise a
              // refetch wiped retention (A/R money) + pay links (no DB copy) and
              // blanked portal/qbo state in memory. numeric columns come back as
              // strings from PostgREST, so wrap in Number().
              retentionPercent: r.retention_percent == null ? undefined : Number(r.retention_percent),
              retentionAmount: r.retention_amount == null ? undefined : Number(r.retention_amount),
              retentionReleased: r.retention_released == null ? undefined : Number(r.retention_released),
              retentionReleases: (r.retention_releases as Invoice['retentionReleases']) ?? undefined,
              payLinkUrl: (r.pay_link_url as string | null) ?? undefined,
              payLinkId: (r.pay_link_id as string | null) ?? undefined,
              // MONEY-F2: the dollars the link was minted for (column arrives
              // with migration 20260904100100; absent → undefined). Without it
              // every refetch hid the portal's Pay button — portalSnapshot shows
              // Pay only while payLinkAmount matches the balance to the cent.
              payLinkAmount: r.pay_link_amount == null ? undefined : Number(r.pay_link_amount),
              // #83/#135 (wave 4, CONTRACT 3): a bank payment the client started
              // on the Pay link and that is still settling — the invoice screen
              // shows it in place of a Pay link he would otherwise re-send.
              // Server-owned (stripe-webhook); invoiceUpdatePayload never writes it.
              ...pendingPaymentFromRow(r),
              portalState: (r.portal_state as Invoice['portalState']) ?? undefined,
              qboId: (r.qbo_id as string | null) ?? undefined,
              qboHash: (r.qbo_hash as string | null) ?? undefined,
              qboSyncedAt: (r.qbo_synced_at as string | null) ?? undefined,
              qboSyncStatus: (r.qbo_sync_status as Invoice['qboSyncStatus']) ?? undefined,
              qboError: (r.qbo_error as string | null) ?? undefined,
              qboRetryCount: r.qbo_retry_count == null ? undefined : Number(r.qbo_retry_count),
              // Contract-milestone link (the invoice-side half of the
              // double-bill guard) + dunning markers. The dunning columns are
              // written ONLY by the invoice-dunning edge fn; the app reads them
              // so the invoice screen can state "Reminder sent · Stage 2 ·
              // Nov 14" instead of the GC guessing whether the client was
              // already chased.
              sourceMilestoneId: (r.source_milestone_id as string | null) ?? undefined,
              sourceContractId: (r.source_contract_id as string | null) ?? undefined,
              dunningStage: r.dunning_stage == null ? undefined : Number(r.dunning_stage),
              dunningLastSentAt: (r.dunning_last_sent_at as string | null) ?? undefined,
              // #47: who he last emailed it to — reminders go there first.
              ...invoiceBillToFromRow(r),
            })) as Invoice[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #48: and a row with a queued EDIT keeps the device copy — this
            // list is now re-read on every return to the foreground (to pick
            // up a client's Stripe payment), and the server's pre-edit row
            // would otherwise replace a payment he recorded offline.
            // #5 (wave 4): and an invoice whose write is still on the wire
            // keeps its device copy too — Home's pull-to-refresh and the
            // realtime echo invalidate this list with no guard, and a read
            // answered before a new invoice's INSERT committed dropped it
            // (before an edit landed: reverted it). This device's INSERTs
            // still reporting (invoiceInsertsRef) plus every insert/update
            // tracked by touchedWrite; one removed meanwhile stays gone.
            // A refused append is already off the device copy: reverted on the
            // direct 'failed' answer, stripped by the onQueueDropped listener
            // (stripDroppedPayment) when a flush refused a queued one.
            const priorInvoices = await loadLocal<Invoice[]>(INVOICES_KEY, []);
            const keepInvoices = new Set([...await queuedIdsFor('invoices'), ...await unsavedWriteIds('invoices')]);
            const deletedInvoices = await queuedDeletesFor('invoices');
            await dropRpcOnlyLedgerIds(keepInvoices, 'invoices', userId); // a refused append is already off the device copy
            const touchedInv = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorInvoices);
            const merged = mergeServerKeepingPending(mapped, priorInvoices, new Set([...keepInvoices, ...invoiceInsertsRef.current.keys(), ...touchedInv.keep]), { deletedIds: new Set([...deletedInvoices, ...touchedInv.gone]) });
            notePortalRead('invoices', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, INVOICES_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('invoices', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<Invoice[]>(INVOICES_KEY, []);
    },
  });

  // Commitments — signed subs/POs for job costing. Now cloud-backed
  // via the public.commitments table (added in the t1.1 audit-fix
  // migration). Read pattern: try Supabase, fall back to AsyncStorage if
  // cloud read fails or returns empty (offline / fresh-install paths).
  const commitmentsQuery = useQuery({
    queryKey: ['commitments', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          // #5 (wave 4): readStartedAt before the SELECT (see invoices).
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('commitments').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              number: (r.number as string) ?? '', type: r.type as Commitment['type'],
              subcontractorId: (r.subcontractor_id as string | null) ?? undefined,
              vendorName: (r.vendor_name as string | null) ?? undefined,
              description: (r.description as string) ?? '',
              amount: Number(r.amount) || 0,
              changeAmount: r.change_amount == null ? undefined : Number(r.change_amount),
              signedDate: (r.signed_date as string | null) ?? '',
              phase: (r.phase as string | null) ?? undefined,
              csiDivision: (r.csi_division as string | null) ?? undefined,
              linkedEstimateItems: (r.linked_estimate_items as string[] | null) ?? undefined,
              status: r.status as Commitment['status'],
              notes: (r.notes as string | null) ?? undefined,
              paidToDate: r.paid_to_date == null ? 0 : Number(r.paid_to_date),
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Commitment[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #5 (wave 4): a commitment written while this read was out (the
            // sub-invoice approve / reject paths, an award) keeps its device
            // copy; one deleted meanwhile stays gone — see daily reports.
            const priorCommitments = await loadLocal<Commitment[]>(COMMITMENTS_KEY, []);
            const touchedCm = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorCommitments);
            const merged = mergeLocalOnly(mapped, priorCommitments, new Set([...await queuedIdsFor('commitments'), ...await unsavedWriteIds('commitments'), ...touchedCm.keep]), { deletedIds: new Set([...await queuedDeletesFor('commitments'), ...touchedCm.gone]) });
            await saveOwnedLocal(userId, COMMITMENTS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<Commitment[]>(COMMITMENTS_KEY, []);
    },
  });

  // Prequal packets — one per subcontractor. Magic-link token lives on
  // the packet; the sub's /prequal-form route looks the packet up by
  // token. Cloud-backed as of the t1.1 migration.
  const prequalQuery = useQuery({
    queryKey: ['prequalPackets', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('prequal_packets').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              subcontractorId: r.subcontractor_id as string,
              projectId: (r.project_id as string | null) ?? undefined,
              status: r.status as PrequalPacket['status'],
              criteria: (r.criteria as PrequalPacket['criteria']) ?? {} as PrequalPacket['criteria'],
              financials: (r.financials as PrequalPacket['financials']) ?? {} as PrequalPacket['financials'],
              safety: (r.safety as PrequalPacket['safety']) ?? {} as PrequalPacket['safety'],
              insurance: (r.insurance as PrequalPacket['insurance']) ?? {} as PrequalPacket['insurance'],
              licenses: (r.licenses as PrequalPacket['licenses']) ?? [],
              w9OnFile: !!r.w9_on_file,
              w9DocPath: (r.w9_doc_path as string | null) ?? undefined,
              inviteToken: (r.invite_token as string | null) ?? undefined,
              inviteSentAt: (r.invite_sent_at as string | null) ?? undefined,
              inviteEmail: (r.invite_email as string | null) ?? undefined,
              submittedAt: (r.submitted_at as string | null) ?? undefined,
              reviewedAt: (r.reviewed_at as string | null) ?? undefined,
              reviewedBy: (r.reviewed_by as string | null) ?? undefined,
              autoReviewFindings: (r.auto_review_findings as PrequalPacket['autoReviewFindings']) ?? undefined,
              reviewerNotes: (r.reviewer_notes as string | null) ?? undefined,
              expiresAt: (r.expires_at as string | null) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as PrequalPacket[];
            // #24 (wave 5): the packets now join the foreground re-read, so a
            // review made offline (queued) or refused (under Not saved) keeps
            // the device row until it lands — the SELECT still holds the old
            // status — and a queued delete stays gone.
            const prior = await loadLocal<PrequalPacket[]>(PREQUAL_KEY, []);
            const merged = mergeLocalOnly(mapped, prior,
              new Set([...await queuedIdsFor('prequal_packets'), ...await unsavedWriteIds('prequal_packets')]),
              { deletedIds: await queuedDeletesFor('prequal_packets') });
            await saveOwnedLocal(userId, PREQUAL_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<PrequalPacket[]>(PREQUAL_KEY, []);
    },
  });

  const dailyReportsQuery = useQuery({
    queryKey: ['dailyReports', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('daily_reports').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            // A DFR's photos are a nested JSON array whose `uri` values are now
            // bucket paths. Flatten every path across every report so the whole
            // page costs ONE signing round trip, and keep this device's local
            // originals (see photosQuery for the rationale).
            // F1 (wave 4): same rule as punch items — see utils/deviceLocalCopy.
            const dfrPriorLocal = new Map<string, PriorDeviceCopy>();
            for (const dr of await loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, [])) {
              for (const p of dr.photos ?? []) {
                const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
                if (local) dfrPriorLocal.set(p.id, { local, path: p.storagePath });
              }
            }
            const dfrLocalUri = new Map<string, string>();
            for (const r of data) {
              for (const p of ((r.photos as DFRPhoto[] | null) ?? [])) {
                if (!p) continue;
                const keep = deviceCopyForServerRow(dfrPriorLocal.get(p.id), p.uri);
                if (keep) dfrLocalUri.set(p.id, keep);
              }
            }
            const resolveDfrPhoto = await buildPhotoUrlResolver(
              data.flatMap(r => ((r.photos as DFRPhoto[] | null) ?? [])
                .filter(p => p && !dfrLocalUri.has(p.id))
                .map(p => p.uri)),
            );
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, date: r.date as string,
              weather: r.weather as DailyFieldReport['weather'], manpower: r.manpower as DailyFieldReport['manpower'],
              workPerformed: (r.work_performed as string) ?? '', materialsDelivered: (r.materials_delivered as string[]) ?? [],
              issuesAndDelays: (r.issues_and_delays as string) ?? '',
              photos: (((r.photos as DFRPhoto[] | null) ?? []).map((p) => {
                const localUri = dfrLocalUri.get(p.id);
                const { uri, storagePath } = resolveDfrPhoto(p.uri, localUri);
                return { ...p, uri, storagePath, localUri };
              })) as DailyFieldReport['photos'],
              status: (r.status as DailyFieldReport['status']) ?? 'draft',
              incident: (r.incident as DailyFieldReport['incident']) ?? undefined,
              workProgress: (r.work_progress as DailyFieldReport['workProgress']) ?? undefined,
              homeownerSummary: (r.homeowner_summary as string | null) ?? undefined,
              homeownerSummaryGeneratedAt: (r.homeowner_summary_generated_at as string | null) ?? undefined,
              homeownerSummaryPublished: !!r.homeowner_summary_published,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // See the change_orders mapper: portal_state must be read back or a
              // refetch turns an unshared record into a shared one.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
              // Who filed it (daily_reports.user_id — the author; the owner
              // trigger never rewrites it). Read-only here: #17 republishes the
              // owner's portal when another member's shared report arrives, and
              // the job hub says "Filed by …" (#63). Never written back
              // (user_id is insert-only, DAILY_REPORT_INSERT_ONLY).
              filedByUserId: (r.user_id as string | null) ?? undefined,
            })) as DailyFieldReport[];
            // leakScan is a local-only field (no supabase column). Merge it
            // forward from AsyncStorage so rehydration never wipes a scan the
            // user performed while online. Without this merge, every sync call
            // overwrites the local copy — the one that held leakScan — with
            // the Supabase rows (which lack the field), silently clearing it.
            const prior = await loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, []);
            const priorById = new Map(prior.map(dr => [dr.id, dr]));
            const withLeakScan = mapped.map(dr => {
              const localLeakScan = priorById.get(dr.id)?.leakScan;
              return localLeakScan !== undefined ? { ...dr, leakScan: localLeakScan } : dr;
            });
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #23 round 2: this list is now re-read on every return to the
            // foreground, so a report saved while the read was out keeps its
            // device copy (and one deleted meanwhile stays gone).
            const touchedDr = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, prior);
            const merged = mergeLocalOnly(withLeakScan, prior, new Set([...await queuedIdsFor('daily_reports'), ...await unsavedWriteIds('daily_reports'), ...touchedDr.keep]), { deletedIds: new Set([...await queuedDeletesFor('daily_reports'), ...touchedDr.gone]) });
            notePortalRead('dailyReports', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, DAILY_REPORTS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('dailyReports', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, []);
    },
  });

  // T&M / extra-work field tickets. Same server-first-then-local shape as the
  // DFR query, including the photo-URL resolution: the persisted `uri` is a
  // bucket PATH, so it has to be signed before anything can render it, and this
  // device's local originals win so an offline capture never gets replaced by a
  // path it has no session to open.
  const fieldTicketsQuery = useQuery({
    queryKey: ['fieldTickets', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('field_tickets').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            // Integration round 2 (field): the same device-copy rule as the
            // punch, gallery and DFR loaders (utils/deviceLocalCopy). The copy
            // used to be kept unconditionally, so a T&M photo added from the web
            // file chooser (a blob: URL, dead after a reload) showed broken on
            // the very browser that added it, and a photo replaced or removed on
            // another device kept showing the old file here.
            const priorTickets = await loadLocal<FieldTicket[]>(FIELD_TICKETS_KEY, []);
            const ticketPriorLocal = new Map<string, PriorDeviceCopy>();
            for (const t of priorTickets) {
              for (const p of t.photos ?? []) {
                const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
                if (local) ticketPriorLocal.set(p.id, { local, path: p.storagePath });
              }
            }
            const localUriById = new Map<string, string>();
            for (const r of data) {
              for (const p of ((r.photos as FieldTicketPhoto[] | null) ?? [])) {
                if (!p) continue;
                const keep = deviceCopyForServerRow(ticketPriorLocal.get(p.id), p.uri);
                if (keep) localUriById.set(p.id, keep);
              }
            }
            const resolveTicketPhoto = await buildPhotoUrlResolver(
              data.flatMap(r => ((r.photos as FieldTicketPhoto[] | null) ?? [])
                .filter(p => p && !localUriById.has(p.id))
                .map(p => p.uri)),
            );
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              date: r.date as string,
              workDescription: (r.work_description as string) ?? '',
              reasonExtra: (r.reason_extra as string) ?? '',
              sourceDailyReportId: (r.source_daily_report_id as string | null) ?? undefined,
              labor: (r.labor as FieldTicket['labor']) ?? [],
              materials: (r.materials as FieldTicket['materials']) ?? [],
              equipment: (r.equipment as FieldTicket['equipment']) ?? [],
              photos: (((r.photos as FieldTicketPhoto[] | null) ?? []).map((p) => {
                const localUri = localUriById.get(p.id);
                const { uri, storagePath } = resolveTicketPhoto(p.uri, localUri);
                return { ...p, uri, storagePath, localUri };
              })) as FieldTicket['photos'],
              markupPercent: r.markup_percent == null ? undefined : Number(r.markup_percent),
              status: (r.status as FieldTicket['status']) ?? 'draft',
              authorization: (r.authorization as FieldTicket['authorization']) ?? undefined,
              convertedChangeOrderId: (r.converted_change_order_id as string | null) ?? undefined,
              convertedAt: (r.converted_at as string | null) ?? undefined,
              auditTrail: (r.audit_trail as FieldTicket['auditTrail']) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as FieldTicket[];
            // Integration round 2 (field): merge, never replace. The list used
            // to be swapped wholesale for the server's, so a ticket still queued
            // from this phone (or under Not saved, or saved while this read was
            // out) vanished from the list and its cache on any re-read — and a
            // Discard elsewhere now invalidates this query. Same keep set as the
            // DFR loader; a ticket whose delete is queued stays gone.
            const touchedFt = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorTickets);
            const merged = mergeLocalOnly(
              mapped,
              priorTickets,
              new Set([...await queuedIdsFor('field_tickets'), ...await unsavedWriteIds('field_tickets'), ...touchedFt.keep]),
              { deletedIds: new Set([...await queuedDeletesFor('field_tickets'), ...touchedFt.gone]) },
            );
            await saveOwnedLocal(userId, FIELD_TICKETS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<FieldTicket[]>(FIELD_TICKETS_KEY, []);
    },
  });

  // Delay register. Same server-first-then-local shape as the field tickets.
  //
  // PRE-MIGRATION BEHAVIOUR — READ THIS BEFORE DEBUGGING AN EMPTY REGISTER.
  // public.delay_events does not exist in production until
  // supabase/migrations/20260804120000_delay_events.sql is applied. Until then
  // this select errors, the catch falls through to AsyncStorage, and every
  // write hits a PostgREST schema-cache miss that utils/offlineQueue.ts
  // classifies as TRANSIENT and re-queues. Net effect: the feature works fully
  // on-device and syncs nothing, losing nothing. That is deliberate — the
  // notice clock is worth having before the table lands.
  const delayEventsQuery = useQuery({
    queryKey: ['delayEvents', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('delay_events').select('*').order('first_observed_date', { ascending: true });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              number: Number(r.number),
              cause: (r.cause as DelayEvent['cause']) ?? 'other',
              firstObservedDate: r.first_observed_date as string,
              endedDate: (r.ended_date as string | null) ?? undefined,
              description: (r.description as string) ?? '',
              evidence: (r.evidence as DelayEvidenceRef[] | null) ?? [],
              impactedTaskIds: (r.impacted_task_ids as string[] | null) ?? [],
              claimedDays: Number(r.claimed_days ?? 0),
              concurrentDays: r.concurrent_days == null ? undefined : Number(r.concurrent_days),
              notices: (r.notices as DelayNotice[] | null) ?? [],
              // Never coerce a missing classification into a guess.
              classification: (r.classification as DelayEvent['classification']) ?? 'unclassified',
              changeOrderId: (r.change_order_id as string | null) ?? undefined,
              auditTrail: (r.audit_trail as DelayEvent['auditTrail']) ?? undefined,
              sealedAt: (r.sealed_at as string | null) ?? undefined,
              contentHash: (r.content_hash as string | null) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as DelayEvent[];
            await saveOwnedLocal(userId, DELAY_EVENTS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback — table may not exist yet */ }
      }
      return loadLocal<DelayEvent[]>(DELAY_EVENTS_KEY, []);
    },
  });

  // Deliveries hydrate the same way. Without this query the collection is
  // write-only — saved to AsyncStorage on every add and never read back, so
  // every scheduled delivery vanishes on app restart.
  const deliveriesQuery = useQuery({
    queryKey: ['deliveries', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('deliveries').select('*').order('expected_date', { ascending: true });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              description: (r.description as string) ?? '',
              supplier: (r.supplier as string) ?? '',
              commitmentId: (r.commitment_id as string | null) ?? undefined,
              poNumber: (r.po_number as string | null) ?? undefined,
              expectedDate: r.expected_date as string,
              // Column is delivery_window — `window` is reserved in Postgres.
              window: (r.delivery_window as string | null) ?? undefined,
              status: (r.status as Delivery['status']) ?? 'scheduled',
              confirmedAt: (r.confirmed_at as string | null) ?? undefined,
              deliveredAt: (r.delivered_at as string | null) ?? undefined,
              receiptId: (r.receipt_id as string | null) ?? undefined,
              location: (r.location as string | null) ?? undefined,
              receivedBy: (r.received_by as string | null) ?? undefined,
              notes: (r.notes as string | null) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as Delivery[];
            await saveOwnedLocal(userId, DELIVERIES_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback — table may not exist yet */ }
      }
      return loadLocal<Delivery[]>(DELIVERIES_KEY, []);
    },
  });

  // Delivery receipts — what ACTUALLY arrived. public.delivery_receipts has been
  // live in prod with RLS since the rls_baseline migration and no code has ever
  // touched it; every reference in this repo was a comment. This is the read.
  const deliveryReceiptsQuery = useQuery({
    queryKey: ['deliveryReceipts', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('delivery_receipts').select('*').order('received_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              deliveryId: (r.delivery_id as string | null) ?? undefined,
              date: r.date as string,
              supplier: (r.supplier as string) ?? '',
              poNumber: (r.po_number as string | null) ?? undefined,
              commitmentId: (r.commitment_id as string | null) ?? undefined,
              items: (r.items as DeliveryReceipt['items'] | null) ?? [],
              bolPhotoUri: (r.bol_photo_uri as string | null) ?? undefined,
              signaturePhotoUri: (r.signature_photo_uri as string | null) ?? undefined,
              hasDamage: Boolean(r.has_damage),
              damageNotes: (r.damage_notes as string | null) ?? undefined,
              receivedAt: r.received_at as string,
              receivedBy: (r.received_by as string) ?? '',
              notes: (r.notes as string | null) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as DeliveryReceipt[];
            await saveOwnedLocal(userId, DELIVERY_RECEIPTS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback — table may be unreachable */ }
      }
      return loadLocal<DeliveryReceipt[]>(DELIVERY_RECEIPTS_KEY, []);
    },
  });

  // Building access: what the building requires (one row per project) and the
  // slots requested from it. Local-first like the rest; the conflict engine in
  // utils/buildingAccess joins these against deliveries.
  const buildingAccessQuery = useQuery({
    queryKey: ['buildingAccess', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('building_access_rules').select('*');
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              projectId: r.project_id as string,
              buildingContact: (r.building_contact as string | null) ?? undefined,
              buildingPhone: (r.building_phone as string | null) ?? undefined,
              requiresFreightElevator: Boolean(r.requires_freight_elevator),
              requiresDockReservation: Boolean(r.requires_dock_reservation),
              requiresCoiOnFile: Boolean(r.requires_coi_on_file),
              coiOnFileAt: (r.coi_on_file_at as string | null) ?? undefined,
              requiresBadging: Boolean(r.requires_badging),
              badgeLeadTimeDays: r.badge_lead_time_days == null ? undefined : Number(r.badge_lead_time_days),
              workHours: (r.work_hours as string | null) ?? undefined,
              afterHoursRequiresApproval: Boolean(r.after_hours_requires_approval),
              notes: (r.notes as string | null) ?? undefined,
              updatedAt: r.updated_at as string,
            })) as BuildingAccessRules[];
            await saveOwnedLocal(userId, BUILDING_ACCESS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback — table may not exist yet */ }
      }
      return loadLocal<BuildingAccessRules[]>(BUILDING_ACCESS_KEY, []);
    },
  });

  const accessReservationsQuery = useQuery({
    queryKey: ['accessReservations', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('access_reservations').select('*').order('date', { ascending: true });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              kind: (r.kind as AccessReservation['kind']) ?? 'freight_elevator',
              date: r.date as string,
              // Column is reservation_window — `window` is reserved in Postgres.
              window: (r.reservation_window as string | null) ?? undefined,
              status: (r.status as AccessReservation['status']) ?? 'requested',
              confirmationRef: (r.confirmation_ref as string | null) ?? undefined,
              deliveryId: (r.delivery_id as string | null) ?? undefined,
              requestedAt: (r.requested_at as string | null) ?? undefined,
              confirmedAt: (r.confirmed_at as string | null) ?? undefined,
              notes: (r.notes as string | null) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as AccessReservation[];
            await saveOwnedLocal(userId, ACCESS_RESERVATIONS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback — table may not exist yet */ }
      }
      return loadLocal<AccessReservation[]>(ACCESS_RESERVATIONS_KEY, []);
    },
  });

  const leadsQuery = useQuery({
    queryKey: ['leads', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('leads').select('*').order('received_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              name: (r.name as string) ?? '',
              phone: (r.phone as string) ?? undefined,
              email: (r.email as string) ?? undefined,
              address: (r.address as string) ?? undefined,
              projectType: (r.project_type as string) ?? undefined,
              projectTypeMapped: (r.project_type_mapped as Lead['projectTypeMapped']) ?? undefined,
              scope: (r.scope as string) ?? undefined,
              budgetMin: (r.budget_min as number) ?? undefined,
              budgetMax: (r.budget_max as number) ?? undefined,
              timeline: (r.timeline as string) ?? undefined,
              source: (r.source as Lead['source']) ?? 'other',
              sourceOther: (r.source_other as string) ?? undefined,
              stage: (r.stage as LeadStage) ?? 'new',
              score: (r.score as number) ?? undefined,
              scoreReason: (r.score_reason as string) ?? undefined,
              receivedAt: r.received_at as string,
              firstRespondedAt: (r.first_responded_at as string) ?? undefined,
              touches: (r.touches as LeadTouch[]) ?? [],
              convertedProjectId: (r.converted_project_id as string) ?? undefined,
              lostReason: (r.lost_reason as string) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as Lead[];
            await saveOwnedLocal(userId, LEADS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<Lead[]>(LEADS_KEY, []);
    },
  });

  const bidPackagesQuery = useQuery({
    queryKey: ['bid_packages', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('bid_packages').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              name: (r.name as string) ?? '',
              csiDivision: (r.csi_division as string) ?? undefined,
              phase: (r.phase as string) ?? undefined,
              scopeDescription: (r.scope_description as string) ?? undefined,
              linkedEstimateItemIds: (r.linked_estimate_item_ids as string[]) ?? [],
              estimateBudget: Number(r.estimate_budget) || 0,
              status: (r.status as BidPackageStatus) ?? 'open',
              dueDate: (r.due_date as string) ?? undefined,
              requiredByDate: (r.required_by_date as string) ?? undefined,
              awardedBidId: (r.awarded_bid_id as string) ?? undefined,
              awardedCommitmentId: (r.awarded_commitment_id as string) ?? undefined,
              buyoutSavings: r.buyout_savings != null ? Number(r.buyout_savings) : undefined,
              notes: (r.notes as string) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as BidPackage[];
            await saveOwnedLocal(userId, BID_PACKAGES_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<BidPackage[]>(BID_PACKAGES_KEY, []);
    },
  });

  const bidPackageBidsQuery = useQuery({
    queryKey: ['bid_package_bids', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('bid_package_bids').select('*').order('submitted_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              packageId: r.package_id as string,
              subcontractorId: (r.subcontractor_id as string) ?? undefined,
              vendorName: (r.vendor_name as string) ?? undefined,
              amount: Number(r.amount) || 0,
              includes: (r.includes as string) ?? undefined,
              excludes: (r.excludes as string) ?? undefined,
              terms: (r.terms as string) ?? undefined,
              source: (r.source as BidPackageBid['source']) ?? undefined,
              status: (r.status as BuyoutBidStatus) ?? 'received',
              submittedAt: r.submitted_at as string,
              normalizedAdjustment: r.normalized_adjustment != null ? Number(r.normalized_adjustment) : undefined,
              normalizedAdjustmentReason: (r.normalized_adjustment_reason as string) ?? undefined,
              notes: (r.notes as string) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as BidPackageBid[];
            await saveOwnedLocal(userId, BID_PACKAGE_BIDS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<BidPackageBid[]>(BID_PACKAGE_BIDS_KEY, []);
    },
  });

  const subsQuery = useQuery({
    queryKey: ['subcontractors', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('subcontractors').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyName: (r.company_name as string) ?? '', contactName: (r.contact_name as string) ?? '',
              phone: (r.phone as string) ?? '', email: (r.email as string) ?? '', address: (r.address as string) ?? '',
              trade: (r.trade as Subcontractor['trade']) ?? 'General', licenseNumber: (r.license_number as string) ?? '',
              licenseExpiry: (r.license_expiry as string) ?? '', coiExpiry: (r.coi_expiry as string) ?? '',
              w9OnFile: (r.w9_on_file as boolean) ?? false, bidHistory: (r.bid_history as Subcontractor['bidHistory']) ?? [],
              assignedProjects: (r.assigned_projects as string[]) ?? [], notes: (r.notes as string) ?? '',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // #27 (wave 5, CONTRACT 17): legal name, TIN last-4, the two
              // verification stamps and the W-9 path — saved on the phone and
              // lost at the next read until these were mapped.
              ...subcontractorExtrasFromRow(r),
            })) as Subcontractor[];
            await saveOwnedLocal(userId, SUBS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<Subcontractor[]>(SUBS_KEY, []);
    },
  });

  const punchItemsQuery = useQuery({
    queryKey: ['punchItems', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          // Queued pin writes BEFORE the SELECT as well as after it: a flush
          // that lands one while the SELECT runs takes it out of the queue, and
          // the tracker only sees direct writes — so the post-SELECT read alone
          // missed it and the old pin flicked back until the next refetch.
          let queuedPinsBefore = new Set<string>();
          try { queuedPinsBefore = pendingPinIdsInQueue(await getOfflineQueue()); } catch { /* the post-SELECT read still runs */ }
          const bearerBefore = await readBearer();
          const fetchStartedAt = Date.now();
          const { data, error } = await supabase.from('punch_items').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            // photo_uri holds a bucket path — sign the batch, and keep this
            // device's local original when it still has one. Same treatment as
            // the photo gallery (see photosQuery).
            // F1 (wave 4): the device copy is kept ONLY while it belongs to
            // the object the row still names and can still be opened — a web
            // Replace/Remove elsewhere, or a blob: from a previous tab, must
            // give way to the server (utils/deviceLocalCopy).
            const priorLocal = new Map<string, PriorDeviceCopy>();
            const priorPunch = await loadLocal<PunchItem[]>(PUNCH_ITEMS_KEY, []);
            for (const p of priorPunch) {
              const local = p.photoLocalUri ?? (isDeviceLocalUri(p.photoUri) ? p.photoUri : undefined);
              if (local) priorLocal.set(p.id, { local, path: p.photoStoragePath });
            }
            const cachedLocal = new Map<string, string>();
            for (const r of data) {
              const keep = deviceCopyForServerRow(priorLocal.get(r.id as string), r.photo_uri as string | null | undefined);
              if (keep) cachedLocal.set(r.id as string, keep);
            }
            // Only sign what we'll actually render — on the device that shot
            // them, every photo already has a local file and signing would be
            // pure waste.
            const resolve = await buildPhotoUrlResolver(
              data.filter(r => !cachedLocal.has(r.id as string)).map(r => r.photo_uri as string | undefined),
            );
            const mapped = data.map((r: Record<string, unknown>) => {
              const photoLocalUri = cachedLocal.get(r.id as string);
              const photo = resolve(r.photo_uri as string | undefined, photoLocalUri);
              return {
              id: r.id as string, projectId: r.project_id as string, description: r.description as string,
              location: (r.location as string) ?? '', assignedSub: (r.assigned_sub as string) ?? '',
              assignedSubId: r.assigned_sub_id as string | undefined, dueDate: r.due_date as string,
              priority: (r.priority as PunchItem['priority']) ?? 'medium', status: (r.status as PunchItem['status']) ?? 'open',
              photoUri: photo.uri || undefined, photoStoragePath: photo.storagePath, photoLocalUri,
              // The GPS stamp MUST be read back. punchItemRow writes all four
              // columns; omitting them here made the round trip destructive —
              // a refetch set them to undefined locally, and the next local
              // save wrote that undefined back over a good server row. Same
              // failure shape as the RFI custody chain: written, never read,
              // silently erased. A punch photo's location is evidence.
              // The plan-sheet pin. Written on BOTH insert and update but never
              // read back, so a refetch dropped it and the next local save wrote
              // the loss through — a punch item silently detached from its spot
              // on the drawing, which is the whole point of pinning it.
              planSheetId: (r.plan_sheet_id as string | null) ?? undefined,
              pinX: r.pin_x == null ? undefined : Number(r.pin_x),
              pinY: r.pin_y == null ? undefined : Number(r.pin_y),
              photoLatitude: r.photo_latitude == null ? undefined : Number(r.photo_latitude),
              photoLongitude: r.photo_longitude == null ? undefined : Number(r.photo_longitude),
              photoLocationAccuracyMeters: r.photo_accuracy_meters == null ? undefined : Number(r.photo_accuracy_meters),
              photoLocationLabel: (r.photo_location_label as string | null) ?? undefined,
              // Formal punch vs internal crew list. Read back for the same reason
              // as the pin above — a refetch that dropped it would let the next
              // save write 'punch' over a crew item and publish "sweep the
              // corridor" to the client's portal. Resolved through the one
              // default, so a pre-migration NULL reads as 'punch'.
              listType: punchListTypeOf({ listType: r.list_type as PunchListType | null }),
              // Read back, or saveLocal below overwrites the device copy with a
              // row that forgot which photo it came from — and the markup
              // vanishes even on the device that drew it.
              sourcePhotoId: (r.source_photo_id as string | null) ?? undefined,
              rejectionNote: r.rejection_note as string | undefined,
              // CONTRACT 12: when the GC last sent it back. Read back so the
              // next reject is measured from the server's clock, and a stale
              // copy never looks like a fresh reject.
              rejectedAt: (r.rejected_at as string | null) ?? undefined,
              // #111 / #16: who raised it (the delete gate reads it) and the
              // sub's note from the sub portal. READ only — punchItemToRow /
              // punchItemToUpdateRow never send sub_note, which the sub owns
              // through sub_portal_mark_punch_ready; user_id is set on insert.
              ...punchServerOwnedFromRow(r),
              closedAt: r.closed_at as string | undefined, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              };
            }) as PunchItem[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // …and keep this device's pin on rows whose pin write is still
            // queued or in flight, or the pin he just placed flicks back.
            const merged = keepPendingPinFields(
              // …and rows this device wrote directly while the SELECT ran (an
              // INSERT or whole-row UPDATE on the wire), as rfis/submittals do.
              mergeLocalOnly(mapped, priorPunch, new Set([...await queuedIdsFor('punch_items'), ...await unsavedWriteIds('punch_items'), ...idsWrittenDuringRead(proDocWriteTouchRef.current, fetchStartedAt)]), { deletedIds: await queuedDeletesFor('punch_items'), combine: combinePunchPending }),
              [punchItemsRef.current, priorPunch],
              pinOverlayIds({ queued: new Set([...queuedPinsBefore, ...pendingPinIdsInQueue(await getOfflineQueue())]), tracker: pinWriteTrackerRef.current, fetchStartedAt }),
            );
            notePortalRead('punchItems', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, PUNCH_ITEMS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('punchItems', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<PunchItem[]>(PUNCH_ITEMS_KEY, []);
    },
  });

  const photosQuery = useQuery({
    queryKey: ['projectPhotos', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('photos').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            // `photos.uri` now holds a bucket path. Sign the batch once, and
            // keep this device's own local files where it still has them so
            // the gallery stays instant and survives losing signal.
            // F1 (wave 4): same rule as punch items — see utils/deviceLocalCopy.
            const priorLocal = new Map<string, PriorDeviceCopy>();
            const priorPhotos = await loadLocal<ProjectPhoto[]>(PHOTOS_KEY, []);
            for (const p of priorPhotos) {
              const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
              if (local) priorLocal.set(p.id, { local, path: p.storagePath });
            }
            const cachedLocal = new Map<string, string>();
            for (const r of data) {
              const keep = deviceCopyForServerRow(priorLocal.get(r.id as string), r.uri as string | null | undefined);
              if (keep) cachedLocal.set(r.id as string, keep);
            }
            // Only sign what we'll actually render — on the device that shot
            // them, every photo already has a local file and signing would be
            // pure waste.
            const resolve = await buildPhotoUrlResolver(
              data.filter(r => !cachedLocal.has(r.id as string)).map(r => r.uri as string | undefined),
            );
            const mapped = data.map((r: Record<string, unknown>) => {
              const localUri = cachedLocal.get(r.id as string);
              const { uri, storagePath } = resolve(r.uri as string | undefined, localUri);
              return {
              id: r.id as string, projectId: r.project_id as string, uri, storagePath, localUri,
              timestamp: r.timestamp as string, location: r.location as string | undefined,
              tag: r.tag as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              linkedTaskName: r.linked_task_name as string | undefined,
              markup: (r.markup as ProjectPhoto['markup']) ?? [], createdAt: r.created_at as string,
              // See the change_orders mapper: portal_state must be read back or a
              // refetch turns an unshared record into a shared one.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
              // Who took it (photos.user_id), for #17's "another member's shared
              // photo arrived" — read-only, never written back.
              userId: (r.user_id as string | null) ?? undefined,
              // #65 (wave 5, CONTRACT 18): where it was taken — stamped at
              // capture, and until now never written or read back.
              ...photoGeoFromRow(r),
              };
            }) as ProjectPhoto[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #23 round 2: re-read on every foreground — see daily reports.
            const touchedPh = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorPhotos);
            const merged = mergeLocalOnly(mapped, priorPhotos, new Set([...await queuedIdsFor('photos'), ...await unsavedWriteIds('photos'), ...touchedPh.keep]), { deletedIds: new Set([...await queuedDeletesFor('photos'), ...touchedPh.gone]) });
            notePortalRead('photos', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, PHOTOS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('photos', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<ProjectPhoto[]>(PHOTOS_KEY, []);
    },
  });

  const priceAlertsQuery = useQuery({
    queryKey: ['priceAlerts', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('price_alerts').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, materialId: r.material_id as string, materialName: r.material_name as string,
              targetPrice: Number(r.target_price), direction: (r.direction as PriceAlert['direction']) ?? 'below',
              currentPrice: Number(r.current_price), isTriggered: (r.is_triggered as boolean) ?? false,
              isPaused: (r.is_paused as boolean) ?? false, createdAt: r.created_at as string,
            })) as PriceAlert[];
            await saveOwnedLocal(userId, PRICE_ALERTS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<PriceAlert[]>(PRICE_ALERTS_KEY, []);
    },
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, firstName: r.first_name as string, lastName: (r.last_name as string) ?? '',
              companyName: (r.company_name as string) ?? '', role: (r.role as Contact['role']) ?? 'Other',
              email: (r.email as string) ?? '', secondaryEmail: r.secondary_email as string | undefined,
              phone: (r.phone as string) ?? '', address: (r.address as string) ?? '', notes: (r.notes as string) ?? '',
              linkedProjectIds: (r.linked_project_ids as string[]) ?? [],
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Contact[];
            await saveOwnedLocal(userId, CONTACTS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<Contact[]>(CONTACTS_KEY, []);
    },
  });

  const commEventsQuery = useQuery({
    queryKey: ['commEvents', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('comm_events').select('*').order('timestamp', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, type: r.type as CommunicationEvent['type'],
              summary: (r.summary as string) ?? '', actor: (r.actor as string) ?? '',
              recipient: r.recipient as string | undefined, detail: r.detail as string | undefined,
              isPrivate: (r.is_private as boolean) ?? false, timestamp: r.timestamp as string,
            })) as CommunicationEvent[];
            await saveOwnedLocal(userId, COMM_EVENTS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<CommunicationEvent[]>(COMM_EVENTS_KEY, []);
    },
  });

  const rfisQuery = useQuery({
    queryKey: ['rfis', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('rfis').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              subject: r.subject as string, question: (r.question as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', assignedTo: (r.assigned_to as string) ?? '',
              assignedSubId: (r.assigned_sub_id as string | null) ?? undefined,
              // The custody chain. Without these two the hold-time engine reports
              // every RFI as unmeasurable, and saveLocal() below would overwrite
              // the local copy with the stripped version — erasing the evidence.
              ballInCourt: (r.ball_in_court as RFI['ballInCourt'] | null) ?? undefined,
              handoffs: (r.handoffs as RFI['handoffs'] | null) ?? undefined,
              dateSubmitted: r.date_submitted as string, dateRequired: r.date_required as string,
              dateResponded: r.date_responded as string | undefined, response: r.response as string | undefined,
              status: (r.status as RFI['status']) ?? 'open', priority: (r.priority as RFI['priority']) ?? 'normal',
              linkedDrawing: r.linked_drawing as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              attachments: (r.attachments as string[]) ?? [], shareToken: r.share_token as string | undefined,
              // Same reason as the punch mapper: without it a refetch drops the
              // link to the annotated photo and the markup disappears.
              sourcePhotoId: (r.source_photo_id as string | null) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // #55 review round: the server's own stamp, kept apart from the
              // display one (updateRFI / updateSubmittal send it).
              serverUpdatedAt: (r.updated_at as string | null) ?? undefined,
              // portal_state MUST be read back. It is written on insert and on every
              // send/recall, but was hydrated ONLY by the invoices mapper — so a refetch
              // stripped it here, saveLocal destroyed the local copy, and
              // portalSnapshot.isShared() treats undefined as SENT (grandfathering
              // pre-portal records). Net effect: unsent DRAFTS and explicitly RECALLED
              // items became client-visible on the next project open.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
            })) as RFI[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #55 review round: an edit on the wire (or settled after this read
            // went out) keeps the device row — the read may predate it, and its
            // older server stamp would make his next reopen a silent no-op.
            const keepDevice = new Set([...await queuedIdsFor('rfis'), ...await unsavedWriteIds('rfis'), ...idsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt)]);
            // #30: a kept device row still takes the server's token / created_at
            // when it has none (withServerShareToken).
            const merged = mergeLocalOnly(mapped, await loadLocal<RFI[]>(RFIS_KEY, []), keepDevice, { deletedIds: await queuedDeletesFor('rfis'), combine: withServerShareToken });
            notePortalRead('rfis', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, RFIS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('rfis', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<RFI[]>(RFIS_KEY, []);
    },
  });

  const submittalsQuery = useQuery({
    queryKey: ['submittals', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('submittals').select('*').order('created_at', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              title: r.title as string, specSection: (r.spec_section as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', submittedDate: r.submitted_date as string,
              requiredDate: r.required_date as string, reviewCycles: (r.review_cycles as Submittal['reviewCycles']) ?? [],
              currentStatus: (r.current_status as Submittal['currentStatus']) ?? 'pending',
              // #60 / #144: read back what submittalMutableRow writes, or the
              // next saveLocal wipes the task link and the AI lead on this phone.
              ...submittalIntakeFromRow(r),
              attachments: (r.attachments as string[]) ?? [], shareToken: r.share_token as string | undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // #55 review round: the server's own stamp, kept apart from the
              // display one (updateRFI / updateSubmittal send it).
              serverUpdatedAt: (r.updated_at as string | null) ?? undefined,
              // portal_state MUST be read back. It is written on insert and on every
              // send/recall, but was hydrated ONLY by the invoices mapper — so a refetch
              // stripped it here, saveLocal destroyed the local copy, and
              // portalSnapshot.isShared() treats undefined as SENT (grandfathering
              // pre-portal records). Net effect: unsent DRAFTS and explicitly RECALLED
              // items became client-visible on the next project open.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
            })) as Submittal[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #55 review round: an edit on the wire (or settled after this read
            // went out) keeps the device row — the read may predate it, and its
            // older server stamp would make his next reopen a silent no-op.
            const keepDevice = new Set([...await queuedIdsFor('submittals'), ...await unsavedWriteIds('submittals'), ...idsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt)]);
            const merged = mergeLocalOnly(mapped, await loadLocal<Submittal[]>(SUBMITTALS_KEY, []), keepDevice, { deletedIds: await queuedDeletesFor('submittals'), combine: withServerShareToken });
            await saveOwnedLocal(userId, SUBMITTALS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<Submittal[]>(SUBMITTALS_KEY, []);
    },
  });

  // OAC Meetings — local-only for now (no Supabase mirror). Lives in
  // mageid_oac_meetings AsyncStorage key. Add server sync later if
  // cross-device meetings become a need.
  // OAC Meetings — server-synced. Reads from Supabase first, falls back
  // to local AsyncStorage when offline. Writes go through supabaseWrite
  // for offline-queue support.
  const oacMeetingsQuery = useQuery({
    queryKey: ['oac_meetings', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('oac_meetings').select('*').order('scheduled_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              number: Number(r.number),
              scheduledAt: r.scheduled_at as string,
              durationMinutes: r.duration_minutes as number | undefined,
              location: r.location as string | undefined,
              attendees: (r.attendees as OACMeeting['attendees']) ?? [],
              agenda: (r.agenda as OACMeeting['agenda']) ?? [],
              actionItems: (r.action_items as OACMeeting['actionItems']) ?? [],
              transcript: r.transcript as string | undefined,
              minutes: r.minutes as string | undefined,
              status: (r.status as OACMeeting['status']) ?? 'draft',
              distributedAt: r.distributed_at as string | undefined,
              distributionLog: r.distribution_log as OACMeeting['distributionLog'],
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as OACMeeting[];
            await saveOwnedLocal(userId, OAC_MEETINGS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<OACMeeting[]>(OAC_MEETINGS_KEY, []);
    },
  });
  const coisQuery = useQuery({
    queryKey: ['cois', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('cois').select('*').order('uploaded_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              subcontractorId: r.subcontractor_id as string,
              projectId: r.project_id as string | undefined,
              fileUri: r.file_uri as string,
              uploadedAt: r.uploaded_at as string,
              validation: r.validation as CertificateOfInsurance['validation'],
              coverages: (r.coverages as CertificateOfInsurance['coverages']) ?? [],
              notes: r.notes as string | undefined,
            })) as CertificateOfInsurance[];
            await saveOwnedLocal(userId, COIS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<CertificateOfInsurance[]>(COIS_KEY, []);
    },
  });

  const equipmentQuery = useQuery({
    queryKey: ['equipment', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('equipment').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string, type: (r.type as Equipment['type']) ?? 'owned',
              category: (r.category as Equipment['category']) ?? 'other', make: (r.make as string) ?? '',
              model: (r.model as string) ?? '', year: r.year as number | undefined,
              serialNumber: r.serial_number as string | undefined, dailyRate: Number(r.daily_rate) || 0,
              currentProjectId: r.current_project_id as string | undefined,
              maintenanceSchedule: (r.maintenance_schedule as Equipment['maintenanceSchedule']) ?? [],
              utilizationLog: (r.utilization_log as Equipment['utilizationLog']) ?? [],
              status: (r.status as Equipment['status']) ?? 'available', notes: r.notes as string | undefined,
              createdAt: r.created_at as string,
            })) as Equipment[];
            await saveOwnedLocal(userId, EQUIPMENT_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<Equipment[]>(EQUIPMENT_KEY, []);
    },
  });

  const onboardingQuery = useQuery({
    queryKey: ['onboarding', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data } = await supabase.from('profiles').select('onboarding_complete').eq('id', userId).single();
          if (data?.onboarding_complete) {
            await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
            return true;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(ONBOARDING_KEY);
      return stored === 'true';
    },
  });

  useEffect(() => { if (onboardingQuery.data !== undefined) setHasSeenOnboarding(onboardingQuery.data); }, [onboardingQuery.data]);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
    queryClient.setQueryData(['onboarding', userId], true);
    if (canSync && userId) {
      // Through the offline queue — a direct .update() here swallowed offline
      // failures, so completing onboarding on a plane never reached the server.
      void supabaseWrite('profiles', 'update', { id: userId, onboarding_complete: true });
    }
  }, [queryClient, userId, canSync]);

  // ── Marketplace persona (user_role) ─────────────────────────────────────
  // Same pattern as the onboarding query: read from Supabase first when
  // online, fall back to the AsyncStorage mirror. The mirror is what lets
  // the root layout's routing gate make a decision before the network
  // resolves on cold boot — without it, every cold boot would briefly flash
  // /persona-select while we wait for the profile fetch.
  const userRoleQuery = useQuery({
    queryKey: ['user_role', userId],
    queryFn: async (): Promise<UserRole | null> => {
      if (canSync) {
        try {
          const { data } = await supabase.from('profiles').select('user_role').eq('id', userId).single();
          const remote = (data?.user_role ?? null) as UserRole | null;
          if (remote) {
            await AsyncStorage.setItem(USER_ROLE_KEY, remote);
            return remote;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(USER_ROLE_KEY);
      if (stored === 'contractor' || stored === 'client' || stored === 'both' || stored === 'property_manager') return stored;
      return null;
    },
  });

  useEffect(() => { if (userRoleQuery.data !== undefined) setUserRoleState(userRoleQuery.data); }, [userRoleQuery.data]);

  const setUserRole = useCallback(async (role: UserRole) => {
    await AsyncStorage.setItem(USER_ROLE_KEY, role);
    setUserRoleState(role);
    queryClient.setQueryData(['user_role', userId], role);
    if (canSync && userId) {
      // Through the offline queue — same reasoning as completeOnboarding above.
      void supabaseWrite('profiles', 'update', { id: userId, user_role: role });
    }
  }, [queryClient, userId, canSync]);

  // Guarded like the loader: a write since the load began keeps its local copy
  // (a no-op for the cache writes saveProjectsMutation mirrors in, which ARE
  // the local copy).
  // Same snapshot as the loader: the pending ids keep the whole device row
  // (#8), and the one fold of the tasks the load read (#96) — consumed here,
  // so a later cache write re-hydrating this effect keeps the device copy.
  useEffect(() => {
    if (projectsQuery.data) {
      const loadedTasks = projectsLoadTasksRef.current;
      projectsLoadTasksRef.current = new Map();
      // Review round 2: before this account's list has hydrated, a pending
      // id the list lacks keeps the row the loader chose (the device copy),
      // not "deleted here" — see withDeviceCopies.
      const local = projectsHydratedForRef.current === userId
        ? projectsRef.current
        : withDeviceCopies(projectsRef.current, projectsQuery.data, projectWriteLogRef.current, projectsLoadSinceRef.current);
      const plan = planProjectsLoad(projectsQuery.data, local, projectWriteLogRef.current, projectsLoadSinceRef.current, {
        pending: projectsLoadPendingRef.current,
        fold: foldServerSchedule<Project>(projectsLoadBaseRef.current, loadedTasks),
      });
      // #90: a job the load found he was removed from stays gone even when
      // the in-memory list still holds it with a pending write.
      const revoked = projectsLoadRevokedRef.current;
      setProjects(revoked.size > 0 ? plan.projects.filter(p => !revoked.has(p.id)) : plan.projects);
      const owed = revokedCleanupOwedRef.current;
      if (owed && owed.userId === userId) {
        revokedCleanupOwedRef.current = null;
        setRevokedCleanup(owed.names);
      }
      projectsHydratedForRef.current = userId;
      // A server load just landed: it owes a re-read exactly when it kept a
      // device row instead of the server's — for a write still queued or on
      // the wire. A row kept only for a Not-saved line owes none (Retry /
      // Discard re-read it); owing it looped the load forever. A cache write
      // re-running this pass is not a load and leaves the flag as it was.
      if (projectsLoadLandedRef.current) {
        projectsLoadLandedRef.current = false;
        projectsReloadOwedRef.current = projectsReloadOwedAfterLoad(plan.keptWhole, projectsLoadLedgerOnlyRef.current);
      }
      void settleOwedProjectsReload();
    }
  // settleOwedProjectsReload reads refs only; its identity follows userId,
  // which already changes projectsQuery.data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsQuery.data]);
  // Mark hydration complete once the query settles (success OR error). We flip
  // it here — not off `projectsQuery.data` — so an empty/failed load still
  // clears the loading state instead of hanging on a spinner forever. Keyed on
  // the account too: the #6 reset drops the flag, and a key whose load is
  // already settled would otherwise never raise it again.
  useEffect(() => {
    if (!projectsQuery.isLoading) setProjectsLoaded(true);
  }, [projectsQuery.isLoading, userId]);
  // Account change (sign-out → sign-in as someone else, a magic link straight
  // to another account). Drop the held pre-load edit and put DEFAULT back in
  // state, so neither the previous account's held branding nor its settings
  // can be merged onto the new account's row (finding 14). Declared before
  // the loads below so a cached result for the new account still wins.
  const settingsOwnerSeenRef = useRef(settingsOwnerKey);
  useEffect(() => {
    if (settingsOwnerSeenRef.current === settingsOwnerKey) return;
    settingsOwnerSeenRef.current = settingsOwnerKey;
    pendingSettingsUpdatesRef.current = null;
    settingsRereadOwedRef.current = false;
    if (settingsLoadedForRef.current !== settingsOwnerKey) commitSettingsState(DEFAULT_SETTINGS);
  }, [settingsOwnerKey, commitSettingsState]);
  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    // Only a result this provider built — a row read, a real device copy, or
    // DEFAULT for a new account / local-only session — counts as his profile
    // (finding 13: a failed read no longer resolves at all). And once loaded,
    // only a result built at the current write sequence is committed: the
    // query can resolve after an edit was made, and committing it would put
    // the pre-edit settings back (finding 15).
    const builtAt = settingsDataSeqRef.current.get(data);
    if (builtAt === undefined) return;
    // A refetch that changed nothing (web focus, a Retry, an owed re-read)
    // keeps the current object: a new identity would re-run every effect
    // keyed on `settings` — project-detail's portal sync re-publishes the
    // snapshot on each one.
    if ((settingsLoadedForRef.current !== settingsOwnerKey || builtAt === settingsWriteSeqRef.current)
      && !sameSettings(data, settingsRef.current)) {
      commitSettingsState(data);
    }
    markSettingsLoaded(settingsOwnerKey);
  }, [settingsQuery.data, commitSettingsState, markSettingsLoaded, settingsOwnerKey]);
  // The re-read a raced load owed: once this device's settings writes have
  // landed (the offline queue flushed a profiles write), read the row again
  // so fields changed on another device still arrive.
  useEffect(() => onQueueFlushed((tables) => {
    if (!tables.has('profiles') || !settingsRereadOwedRef.current || !userId) return;
    settingsRereadOwedRef.current = false;
    void queryClient.invalidateQueries({ queryKey: ['settings', userId] });
  }), [queryClient, userId]);
  // Cache first: a returning GC on job-site LTE has his profile from the device
  // copy at once instead of DEFAULT until the network answers. Skipped when the
  // network load already landed for this account (it is fresher). A fresh
  // device with no copy waits for the network — settingsLoaded stays false.
  useEffect(() => {
    let cancelled = false;
    const key = settingsOwnerKey;
    void loadLocal<AppSettings | null>(SETTINGS_KEY, null).then((cached) => {
      if (cancelled || !cached || settingsLoadedForRef.current === key) return;
      commitSettingsState({ ...DEFAULT_SETTINGS, ...cached });
      markSettingsLoaded(key);
    });
    return () => { cancelled = true; };
  }, [settingsOwnerKey, commitSettingsState, markSettingsLoaded]);
  useEffect(() => {
    if (!changeOrdersQuery.data) return;
    setChangeOrders(changeOrdersQuery.data);
    setChangeOrdersLoadedFor(userId ?? '');
  }, [changeOrdersQuery.data, userId]);
  useEffect(() => {
    if (!invoicesQuery.data) return;
    setInvoices(invoicesQuery.data);
    setInvoicesLoadedFor(userId ?? '');
  }, [invoicesQuery.data, userId]);
  useEffect(() => { if (commitmentsQuery.data) setCommitments(commitmentsQuery.data); }, [commitmentsQuery.data]);
  useEffect(() => { if (prequalQuery.data) setPrequalPackets(prequalQuery.data); }, [prequalQuery.data]);
  useEffect(() => {
    if (!dailyReportsQuery.data) return;
    setDailyReports(dailyReportsQuery.data);
    setDailyReportsLoadedFor(userId ?? '');
  }, [dailyReportsQuery.data, userId]);
  // NOT LOADED WHILE AUTH IS STILL RESOLVING. On a cold start userId is null
  // until the stored session is read, and the signed-out device-cache pass
  // stamps these flags with '' — which `=== (userId ?? '')` then accepted, so
  // a deep-linked daily report / CO / lead opened on the device copy, closed
  // to "loading" when the account resolved, and reopened fresh: anything
  // typed or "saved" in between was thrown away. A null userId only means
  // "signed out" once auth has said so.
  const changeOrdersLoaded = !authLoading && changeOrdersLoadedFor === (userId ?? '');
  const invoicesLoaded = !authLoading && invoicesLoadedFor === (userId ?? '');
  const dailyReportsLoaded = !authLoading && dailyReportsLoadedFor === (userId ?? '');
  useEffect(() => { if (fieldTicketsQuery.data) setFieldTickets(fieldTicketsQuery.data); }, [fieldTicketsQuery.data]);
  useEffect(() => { if (delayEventsQuery.data) setDelayEvents(delayEventsQuery.data); }, [delayEventsQuery.data]);
  useEffect(() => { if (deliveriesQuery.data) setDeliveries(deliveriesQuery.data); }, [deliveriesQuery.data]);
  useEffect(() => { if (buildingAccessQuery.data) setBuildingAccessRules(buildingAccessQuery.data); }, [buildingAccessQuery.data]);
  useEffect(() => { if (accessReservationsQuery.data) setAccessReservations(accessReservationsQuery.data); }, [accessReservationsQuery.data]);
  useEffect(() => { if (deliveryReceiptsQuery.data) setDeliveryReceipts(deliveryReceiptsQuery.data); }, [deliveryReceiptsQuery.data]);
  useEffect(() => { if (subsQuery.data) setSubcontractors(subsQuery.data); }, [subsQuery.data]);
  useEffect(() => {
    if (!leadsQuery.data) return;
    setLeads(leadsQuery.data);
    setLeadsLoadedFor(userId ?? '');
  }, [leadsQuery.data, userId]);
  const leadsLoaded = !authLoading && leadsLoadedFor === (userId ?? ''); // see changeOrdersLoaded
  useEffect(() => { if (bidPackagesQuery.data) setBidPackages(bidPackagesQuery.data); }, [bidPackagesQuery.data]);
  useEffect(() => { if (bidPackageBidsQuery.data) setBidPackageBids(bidPackageBidsQuery.data); }, [bidPackageBidsQuery.data]);
  useEffect(() => {
    if (!punchItemsQuery.data) return;
    setPunchItems(punchItemsQuery.data);
    setPunchItemsLoadedFor(userId ?? '');
  }, [punchItemsQuery.data, userId]);
  const punchItemsLoaded = !authLoading && punchItemsLoadedFor === (userId ?? ''); // see changeOrdersLoaded
  useEffect(() => {
    if (!photosQuery.data) return;
    setProjectPhotos(photosQuery.data);
    setPhotosLoadedFor(userId ?? '');
  }, [photosQuery.data, userId]);
  const photosLoaded = !authLoading && photosLoadedFor === (userId ?? ''); // see changeOrdersLoaded
  useEffect(() => { if (priceAlertsQuery.data) setPriceAlerts(priceAlertsQuery.data); }, [priceAlertsQuery.data]);
  useEffect(() => { if (contactsQuery.data) setContacts(contactsQuery.data); }, [contactsQuery.data]);
  useEffect(() => { if (commEventsQuery.data) setCommEvents(commEventsQuery.data); }, [commEventsQuery.data]);
  useEffect(() => { if (rfisQuery.data) setRfis(rfisQuery.data); }, [rfisQuery.data]);
  useEffect(() => { if (submittalsQuery.data) setSubmittals(submittalsQuery.data); }, [submittalsQuery.data]);
  useEffect(() => { if (oacMeetingsQuery.data) setOacMeetings(oacMeetingsQuery.data); }, [oacMeetingsQuery.data]);
  useEffect(() => { if (coisQuery.data) setCois(coisQuery.data); }, [coisQuery.data]);
  useEffect(() => { if (equipmentQuery.data) setEquipment(equipmentQuery.data); }, [equipmentQuery.data]);

  // Permits — cloud-backed as of t1.1 audit-fix migration. Same fall-back
  // pattern as commitments / rfis: try Supabase, fall back to AsyncStorage
  // when offline / cloud is empty.
  const permitsQuery = useQuery({
    queryKey: ['permits', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
      if (canSync) {
        try {
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('permits').select('*').order('applied_date', { ascending: false });
          // #23: a zero-row answer to his live bearer is the server's answer
          // too (he has no permits) — before, it fell back to the cache and
          // this list could never count as "from the server" for the portal.
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              projectName: (r.project_name as string | null) ?? '',
              type: r.type as Permit['type'],
              permitNumber: (r.permit_number as string | null) ?? undefined,
              jurisdiction: (r.jurisdiction as string) ?? '',
              status: r.status as Permit['status'],
              appliedDate: (r.applied_date as string | null) ?? '',
              approvedDate: (r.approved_date as string | null) ?? undefined,
              expiresDate: (r.expires_date as string | null) ?? undefined,
              inspectionDate: (r.inspection_date as string | null) ?? undefined,
              inspectionNotes: (r.inspection_notes as string | null) ?? undefined,
              fee: Number(r.fee) || 0,
              notes: (r.notes as string | null) ?? undefined,
              phase: (r.phase as string | null) ?? undefined,
              attachmentUri: (r.attachment_uri as string | null) ?? undefined,
              specialInspectionCategory: (r.special_inspection_category as Permit['specialInspectionCategory']) ?? undefined,
              inspectorName: (r.inspector_name as string | null) ?? undefined,
              lastReportSummary: (r.last_report_summary as string | null) ?? undefined,
              lastReportDate: (r.last_report_date as string | null) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Permit[];
            // The device's permits still queued to send (an insert not yet
            // landed) are kept, as the other lists do — with rows too, now
            // (#23 round 2): this list is re-read on every return to the
            // foreground, and a permit added offline must not vanish on the
            // next one. Likewise one written while this read was out.
            const priorPermits = await loadLocal<Permit[]>(PERMITS_KEY, []);
            const touchedPm = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorPermits);
            const next = mergeLocalOnly(mapped, priorPermits, new Set([...await queuedIdsFor('permits'), ...await unsavedWriteIds('permits'), ...touchedPm.keep]), { deletedIds: new Set([...await queuedDeletesFor('permits'), ...touchedPm.gone]) });
            notePortalRead('permits', userId, true, readEpoch); // #23: the server's list
            await saveOwnedLocal(userId, PERMITS_KEY, next);
            return next;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('permits', userId, false, readEpoch); // #23: the device cache, not the server's
      return loadLocal<Permit[]>(PERMITS_KEY, []);
    },
  });
  useEffect(() => { if (permitsQuery.data) setPermits(permitsQuery.data); }, [permitsQuery.data]);
  const savePermitsMutationRaw = useMutation({
    mutationFn: async (updated: Permit[]) => { await saveLocal(PERMITS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['permits', userId], data); },
  });
  const savePermitsMutation = usePortalTrackedSave<Permit[]>(savePermitsMutationRaw, useCallback((next: Permit[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<Permit[]>(['permits', userId]), next));
  }, [queryClient, userId, markPortalDirty]));

  // AIA G702/G703 pay applications — cloud-backed as of t1.1 audit-fix
  // migration. Surfaced in the client portal as a dedicated "Pay
  // Applications" section so the client/architect/lender can review and
  // download a PDF of every certified billing.
  const aiaPayAppsQuery = useQuery({
    queryKey: ['aiaPayApps', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async () => {
      const readEpoch = portalReadEpochRef.current; // #15: the epoch this read STARTED in
      if (canSync) {
        try {
          // #5 (wave 4): readStartedAt before the SELECT (see invoices).
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('aia_pay_apps').select('*').order('application_number', { ascending: false });
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              // MONEY-F1: the data columns hydrate through the pure, round-trip-
              // tested mapper — snapshot_totals → totals (this used to be dropped,
              // so the second pay app of a project crashed on priorAIA.totals and
              // WIP read $0 billed), plus pay_link_* / paid_at, which ARE real
              // columns (migration 20260904100100, applied) and are read here but
              // written only by create-payment-link and the Stripe webhook — see
              // savedToAiaRow's comment for why the app must not write them.
              // The certificate fields with no columns of their own (PERIOD FROM,
              // line 5b's rate, AMOUNT CERTIFIED, the notary jurat) come back
              // through the same mapper, out of the snapshot_totals sidecar.
              // utils/projectContextPure.ts.
              ...aiaRowToSaved(r),
              // portal_state MUST be read back. It is written on insert and on every
              // send/recall, but was hydrated ONLY by the invoices mapper — so a refetch
              // stripped it here, saveLocal destroyed the local copy, and
              // portalSnapshot.isShared() treats undefined as SENT (grandfathering
              // pre-portal records). Net effect: unsent DRAFTS and explicitly RECALLED
              // items became client-visible on the next project open.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
            })) as SavedAIAPayApp[];
            // SYNC-F3: keep offline-created rows whose write is still queued — the
            // SELECT can beat the flush's INSERT and a wholesale overwrite dropped them.
            // #48: a queued edit keeps the device copy (see the invoices loader).
            // #5 (wave 4): and a pay application whose upsert / delete is
            // still on the wire (or settled after this read went out) keeps
            // its device copy — the foreground pass re-reads this list on
            // every return, and a read answered before a first pay app's
            // upsert committed deleted it; before a corrected one's, it put
            // the pre-edit figures back on screen and in the cache.
            const priorAia = await loadLocal<SavedAIAPayApp[]>(AIA_PAY_APPS_KEY, []);
            const touchedAia = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorAia);
            const merged = mergeServerKeepingPending(mapped, priorAia, new Set([...await queuedIdsFor('aia_pay_apps'), ...await unsavedWriteIds('aia_pay_apps'), ...touchedAia.keep]), { deletedIds: new Set([...await queuedDeletesFor('aia_pay_apps'), ...touchedAia.gone]) });
            // #15: the server's list — a publish may now build the pay-app
            // section fresh from it (PORTAL_SIDE_LISTS).
            notePortalRead('aiaPayApps', userId, true, readEpoch);
            await saveOwnedLocal(userId, AIA_PAY_APPS_KEY, merged);
            return merged;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      notePortalRead('aiaPayApps', userId, false, readEpoch); // #15: the device cache, not the server's
      return loadLocal<SavedAIAPayApp[]>(AIA_PAY_APPS_KEY, []);
    },
  });
  useEffect(() => { if (aiaPayAppsQuery.data) setAiaPayApps(aiaPayAppsQuery.data); }, [aiaPayAppsQuery.data]);
  const saveAiaPayAppsMutationRaw = useMutation({
    mutationFn: async (updated: SavedAIAPayApp[]) => { await saveLocal(AIA_PAY_APPS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['aiaPayApps', userId], data); },
  });
  // #15 (wave 4): a tracked save like the other portal-fed lists — sending a
  // pay app to the client portal (applyPortalStates), recalling it, saving or
  // deleting one all mark the job for a republish. It used to be a plain
  // mutation, so a sent pay app reached the portal only when he next opened
  // Client Portal setup, while the homeowner was already messaged about it.
  const saveAiaPayAppsMutation = usePortalTrackedSave<SavedAIAPayApp[]>(saveAiaPayAppsMutationRaw, useCallback((next: SavedAIAPayApp[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<SavedAIAPayApp[]>(['aiaPayApps', userId]), next));
  }, [queryClient, userId, markPortalDirty]));

  // Sub portal links — pull from Supabase if logged in, otherwise local.
  // Mirrors the (project, sub) pair so the share URL can be derived without
  // exposing GC data via the URL hash.
  const subPortalLinksQuery = useQuery({
    queryKey: ['subPortalLinks', userId],
    retry: retryUnlessStaleAccount, // #6: a signed-out account's load is never retried
    queryFn: async (): Promise<SubPortalLink[]> => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('sub_portal_links').select('*');
          if (!error && data && data.length > 0) {
            const mapped = (data as Record<string, unknown>[]).map(r => ({
              id: r.id as string,
              projectId: r.project_id as string,
              subcontractorId: r.subcontractor_id as string,
              passcode: r.passcode as string | undefined,
              requirePasscode: !!r.require_passcode,
              enabled: !!r.enabled,
              welcomeMessage: r.welcome_message as string | undefined,
              commitmentIds: r.commitment_ids as string[] | undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
              lastSharedAt: r.last_shared_at as string | undefined,
              // The token the sub-portal RPCs compare against. This mapper used
              // to drop it, so every load from the server erased it locally and
              // the next upsert minted a DIFFERENT one on the phone — which the
              // plain insert then failed to write (duplicate id), leaving the
              // app sharing a token the server had never seen.
              accessToken: (r.access_token as string | null) || undefined,
            }));
            await saveOwnedLocal(userId, SUB_PORTAL_LINKS_KEY, mapped);
            return mapped;
          }
        } catch (err) { if (err instanceof StaleAccountLoadError) throw err; /* fallback */ }
      }
      return loadLocal<SubPortalLink[]>(SUB_PORTAL_LINKS_KEY, []);
    },
  });
  // The loaded flag flips in the SAME effect that installs the links, so the
  // two commit in one render. Deriving it from `isFetched` instead would leave
  // a render where the query says "loaded" while `subPortalLinks` is still the
  // empty initial state — exactly the window in which app/sub-portal-setup.tsx
  // used to decide "no link" and write a second one for the same sub. The
  // queryFn never throws (the server read falls back to the local cache), so
  // defined data is the loaded signal; a user switch changes the key, the data
  // goes undefined, and the flag drops back until that account's links land.
  useEffect(() => {
    if (subPortalLinksQuery.data) {
      setSubPortalLinks(subPortalLinksQuery.data);
      setSubPortalLinksLoaded(true);
    } else {
      setSubPortalLinksLoaded(false);
    }
  }, [subPortalLinksQuery.data]);
  const saveSubPortalLinksMutation = useMutation({
    mutationFn: async (updated: SubPortalLink[]) => { await saveLocal(SUB_PORTAL_LINKS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['subPortalLinks', userId], data); },
  });

  // `changedKeys` — the Project keys this write changed (updateProject passes
  // its update's keys). #25, the second writer: EVERY project write used to
  // carry `schedule` from this device's local copy, whatever the edit was — a
  // status change, a portal toggle, a geocode — and on iOS that copy is often
  // hours old, so a foreman's progress saved through the field RPC at 10:00
  // was put back to 0% by the GC's 15:00 status change. Now the schedule rides
  // only on a write that touched it (a caller that passes no keys keeps the old
  // send-everything behaviour). A write that DOES carry a stale schedule is
  // still answered by the server: migration 20260917160000's trigger keeps
  // field values newer than the incoming copy's stamps.
  // Schedule Pro waits for its project's syncs to report before it adopts the
  // server's copy (utils/scheduleMerge.ts); these tell it when one has.
  const projectSyncSettledListenersRef = useRef(new Set<() => void>());
  const onProjectSyncSettled = useCallback((listener: () => void) => {
    projectSyncSettledListenersRef.current.add(listener);
    return () => { projectSyncSettledListenersRef.current.delete(listener); };
  }, []);
  const isProjectSyncUnconfirmed = useCallback((projectId: string) => (
    unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).has(projectId)
  ), []);
  const syncProjectToSupabase = useCallback((project: Project, action: 'upsert' | 'delete', opts?: { immediate?: boolean; changedKeys?: readonly string[] }) => {
    const sendProjectWriteNow = supabaseWrite;
    noteProjectWrite(projectWriteLogRef.current, project.id);
    if (!canSync) return;
    const existing = syncDebounceMap.current.get(project.id);
    if (existing?.timer) clearTimeout(existing.timer);
    // A still-waiting sync being replaced here never sends; if it carried the
    // schedule, this one must.
    const sendsSchedule = projectSyncSendsSchedule(opts?.changedKeys, !!existing && !existing.inFlight && existing.sendsSchedule);
    const entry: PendingProjectSync = { timer: null, inFlight: false, sendsSchedule, run: async () => undefined };
    // #4 (wave 4): an immediate upsert is addProject's create — publish how
    // its projects write ends (addProject returns it). Settled exactly once;
    // the finally below covers a throw.
    let settleCreate: (outcome: WriteOutcome) => void = () => undefined;
    if (opts?.immediate && action === 'upsert') {
      const created = new Promise<WriteOutcome>((resolve) => { settleCreate = resolve; });
      projectCreateWritesRef.current.set(project.id, created);
      void created.then(() => {
        if (projectCreateWritesRef.current.get(project.id) === created) projectCreateWritesRef.current.delete(project.id);
      });
    }
    const run = async () => {
      let createLanded = false;
      // SYNC-F7: the slot is released only AFTER the write has reported —
      // deleting it up front meant a flush arriving mid-write found nothing to
      // re-issue. Identity-checked: a newer edit may have replaced this entry.
      entry.inFlight = true;
      inFlightProjectSyncsRef.current.set(entry, project.id);
      if (syncDebounceMap.current.get(project.id) === entry) entry.timer = null;
      try {
        // Behind the queue (hotfix #8, data-loss half). An edit made offline
        // sits in the offline queue as a whole-row write; the queue drains only
        // on launch, foreground and a backoff that grows to 5 min. A new edit
        // written straight to the server landed FIRST, and the drain then
        // replayed the OLDER queued row over it — schedule, status, name — and
        // the post-flush re-pull put that older row back on screen too. While
        // this project has a write queued, this one joins the queue behind it
        // (FIFO keeps the order), the pattern updateInvoice uses. Not on an
        // `immediate` sync: that is a new project, which nothing has queued
        // yet, and its write must go out in this tick (see below).
        let behindQueue = false;
        if (!opts?.immediate) {
          try { behindQueue = (await ownQueuedProjectIds(userId)).has(project.id); } catch { behindQueue = false; }
        }
        // Shadows the import for the rest of this block ON PURPOSE: every
        // project write below goes through the ordered writer, and the
        // validators (financials split, contract terms, context-pure) keep
        // reading the literal supabaseWrite('projects', …) calls.
        const supabaseWrite = orderedProjectWriter(behindQueue, sendProjectWriteNow, addToOfflineQueue);
        if (action === 'delete') {
          await supabaseWrite('projects', 'delete', { id: project.id });
        } else {
          // AUTH-F2/F5: a project this account only COLLABORATES on must not be
          // echoed back with the owner's columns blanked or re-owned. Decided
          // from the project itself (ownerUserId persisted by the loader, the
          // caller's role in the collaborator list) — never from what the last
          // successful server load remembered, which was nothing on an offline
          // launch or after a transient SELECT failure, so a collaborator's
          // edits went out owner-style with the credential-stripped
          // client_portal blob and wiped the owner's passcode.
          const { shared, sendMoney, financialsUserId } = classifyProjectForSync(project, userId, userEmail);
          // The shared PATCH only updates an existing row, so an untouched
          // schedule simply stays out. The owner upsert also CREATES the row
          // when the server lacks it — see serverProjectIdsRef. #7: "lacks"
          // is decided with the persisted set too, so a launch whose projects
          // SELECT failed (or has not settled) does not treat every project as
          // unknown and re-send the cached schedule with a status change.
          // Never awaited on an `immediate` sync: that is addProject's, whose
          // write must be issued synchronously (FIFO ahead of its children,
          // below) — and a project just created cannot be confirmed anyway.
          // The mount-time seed covers every other sync almost always.
          if (!shared && !opts?.immediate && !serverProjectIdsRef.current.has(project.id)) await seedServerProjectIds();
          const includeSchedule = ownerUpsertCarriesSchedule(sendsSchedule, shared, serverProjectIdsRef.current.has(project.id));
          const base = {
            id: project.id, name: project.name, type: project.type,
            location: project.location, square_footage: project.squareFootage, quality: project.quality,
            location_latitude: project.locationLatitude ?? null,
            location_longitude: project.locationLongitude ?? null,
            location_geocoded_at: project.locationGeocodedAt ?? null,
            description: project.description,
            scope: (project.scope ?? null) as unknown,
            ...(includeSchedule ? { schedule: project.schedule as unknown } : {}),
            status: project.status,
            collaborators: project.collaborators as unknown,
            primary_contact: project.primaryContact ?? null,
            lead_source: project.leadSource ?? null,
            target_timeline_notes: project.targetTimelineNotes ?? null,
            handover_checklist: (project.handoverChecklist ?? {}) as unknown,
            closed_at: project.closedAt,
            substantial_completion_date: project.substantialCompletionDate,
            warranty_walk_completed_at: project.warrantyWalkCompletedAt,
            photo_count: project.photoCount,
            updated_at: project.updatedAt,
          };
          // The four legacy money columns are spelled out at BOTH call sites
          // below on purpose: validate-project-financials-split reads the
          // literal call to prove each is paired with a project_financials write.
          const landed = shared
            // Shared row: PATCH by id. Passes projects_update for an editor,
            // needs no user_id (the column is NOT NULL, so the old owner-less
            // upsert failed 23502 — a "violates" the queue classes terminal —
            // and editors could not save anything), can never INSERT, and
            // cannot re-own the row (projects_freeze_ownership would reset it
            // anyway). The owner's client_portal is never echoed back: this
            // device only ever held the credential-stripped copy (AUTH-F5).
            // B-1: money rides along ONLY when this device positively holds it
            // (financialsLoaded !== false — after a transient financials read
            // failure the editor's copy held `estimate: null` it never read,
            // and sending it NULLed the owner's estimate on both tables; B-3:
            // the loader also withholds the stamp while the legacy columns
            // carry money no fin row has caught up with), the caller is not
            // blinded and not a viewer (A-2), and the owner is known (A-1: the
            // paired project_financials row below needs the owner's id, and
            // money must never reach one table without the other). A-1: a
            // cache with NO ownerUserId (pre-field) takes this PATCH path too,
            // base columns only — an owner-style upsert on a guess re-stamped
            // project_financials.user_id with an editor's id.
            ? await supabaseWrite('projects', 'update', {
                ...base,
                ...(sendMoney ? {
                  estimate: project.estimate as unknown,
                  linked_estimate: project.linkedEstimate as unknown,
                  estimate_versions: project.estimateVersions as unknown,
                  target_budget: project.targetBudget as unknown,
                } : {}),
              })
            // Own row: MUST be 'upsert', not 'insert' — this path also fires on
            // every EDIT, and a plain insert on the existing PK fails with a
            // duplicate-key violation (classified terminal), so edits would
            // silently never reach the server and the server-first load on the
            // next launch would revert them locally.
            : await supabaseWrite('projects', 'upsert', {
                ...base, user_id: userId, created_at: project.createdAt,
                // #82 (wave 5, CONTRACT 13): never the homeowner portal key —
                // it lives in portal_credentials, and portal_set_access_token
                // keeps the stored key for this portal id (20260923170000).
                client_portal: ownerClientPortalForWrite(project.clientPortal) as unknown,
                estimate: project.estimate as unknown,
                linked_estimate: project.linkedEstimate as unknown,
                estimate_versions: project.estimateVersions as unknown,
                target_budget: project.targetBudget as unknown,
              });
          // #7: any landed owner upsert means the row exists now, with or
          // without the schedule in this payload — remembered across launches.
          createLanded = landed; // #4 (wave 4): addProject's answer, settled in finally
          if (landed && !shared && liveUserIdRef.current === userId && !serverProjectIdsRef.current.has(project.id)) {
            serverProjectIdsRef.current.add(project.id);
            void persistServerProjectIds();
          }
          // Money also goes to project_financials, which field collaborators
          // cannot read. DUAL-WRITE on purpose: the legacy columns above stay
          // until the phase-2 drop migration, so an older build still loads.
          // Skipped whenever no money went out above (financialsUserId is
          // undefined: blinded, not loaded, or — A-1 — owner unknown on a
          // legacy cache: `user_id` is the tenant filter the mcp function and
          // the QBO mapping read, so stamping the editor's id would move the
          // project out of the owner's views) and when the project write
          // itself was REFUSED — a second RLS refusal would only add a second
          // toast. A write that merely queued (offline) still proceeds: the
          // queue lands projects before project_financials.
          if (financialsUserId && (landed || (await queuedIdsFor('projects')).has(project.id))) {
            await supabaseWrite('project_financials', 'upsert', {
              // PK is project_id (the queue's 'update' targets `id`), so this
              // stays an upsert. Its INSERT policy is can_access_project(…,
              // 'editor'), not auth.uid() = user_id, and the NOT NULL user_id
              // carries the OWNER's id for a shared row.
              project_id: project.id, user_id: financialsUserId,
              estimate: project.estimate as unknown,
              linked_estimate: project.linkedEstimate as unknown,
              estimate_versions: project.estimateVersions as unknown,
              target_budget: project.targetBudget as unknown,
              // Contract terms: a held term always goes; an empty one goes as
              // NULL only once this device has seen the server's terms
              // (contractTermsLoaded) — otherwise it is omitted so a device that
              // never loaded them cannot null out a cap set elsewhere, and a job
              // that never used them adds no column an unmigrated server would
              // re-queue this whole upsert over. types/index.ts has the rule.
              ...contractTermsSyncColumns(project),
              created_at: project.createdAt, updated_at: project.updatedAt,
            });
          }
          // #1 fix round 2: a landed create is "ever confirmed" for good — a
          // job made here, synced, then deleted on the web before this phone
          // next loads carries no loader stamp, and must still never read as
          // "only on this phone". (After the money write, which
          // validate-project-financials-split wants next to the upsert.)
          if (landed && !shared && liveUserIdRef.current === userId && !everConfirmedProjectIdsRef.current.has(project.id)) {
            everConfirmedProjectIdsRef.current.add(project.id);
            void persistEverConfirmedProjectIds();
          }
        }
      } finally {
        if (syncDebounceMap.current.get(project.id) === entry) syncDebounceMap.current.delete(project.id);
        inFlightProjectSyncsRef.current.delete(entry);
        // A load that kept this project's device row may now re-read (#96).
        void settleOwedProjectsReload();
        for (const listener of Array.from(projectSyncSettledListenersRef.current)) {
          try { listener(); } catch (err) { console.log('[ProjectContext] Sync-settled listener failed:', err); }
        }
        // #4 (wave 4): how the create ended — 'synced', else 'queued' when the
        // job's write is in the queue, else 'failed' (a throw included).
        if (createLanded) settleCreate('synced');
        else void queuedIdsFor('projects').then((q) => settleCreate(q.has(project.id) ? 'queued' : 'failed'), () => settleCreate('queued'));
      }
      console.log('[ProjectContext] Synced project to Supabase:', project.name);
    };
    entry.run = run;
    syncDebounceMap.current.set(project.id, entry);
    if (opts?.immediate) {
      // New project: enqueue the upsert NOW (synchronously) so the project row
      // reaches Supabase BEFORE its sub-collections (permits/submittals/etc.)
      // insert — otherwise their project_id FKs violate, those writes fail
      // terminally, and the un-synced project vanishes on the next server-first
      // load (which overwrites local with Supabase). The offline queue is FIFO,
      // so enqueuing first = inserted first.
      void run();
    } else {
      entry.timer = setTimeout(run, 800);
    }
  }, [canSync, userId, userEmail, seedServerProjectIds, persistServerProjectIds, persistEverConfirmedProjectIds, settleOwedProjectsReload]);

  // SYNC-F7: run every debounced project sync NOW. The root layout calls this
  // from its AppState handler on background/inactive (and `pagehide` on web):
  // the 800 ms timer never enters the offline queue, so a kill inside the
  // window lost the edit outright and the next server-first load overwrote
  // the only copy. Each `run` sends or queues its own write.
  const flushPendingProjectSyncs = useCallback(async (): Promise<void> => {
    // A-8: an entry whose run is already in flight stays in the map — its
    // write is on the wire (or queued) and its own finally releases the slot.
    // Only entries still waiting on their debounce timer are fired here — and
    // (#8, review round 1) a fired one stays in the map too, exactly as if its
    // timer had fired: deleting it here left the write on the wire with no
    // map entry and no queue entry, so a foreground refetch started while it
    // was out (iOS: inactive → active inside the 800 ms) read the pre-edit
    // row and put it back on screen. `run` marks itself in flight
    // synchronously, so a second flush still skips it.
    const pending: PendingProjectSync[] = [];
    for (const p of syncDebounceMap.current.values()) {
      if (p.inFlight) continue;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      pending.push(p);
    }
    await Promise.all(pending.map(p => p.run().catch((err) => {
      console.log('[ProjectContext] Flushing a pending project sync failed:', err);
    })));
  }, []);

  // Sign Out / account switch runs this before it drains the offline queue
  // (AuthContext sits above this provider; utils/preSignOutFlush bridges it).
  useEffect(() => registerPreSignOutFlush(flushPendingProjectSyncs), [flushPendingProjectSyncs]);

  // Post-ship review: a GC message sent while a new portalId is still in the
  // project's debounce (or queued offline) was refused by RLS lock 1 with a raw
  // Postgres toast. Every GC-authored portal row goes through here instead.
  // A row without an id gets one: queued, an id-less insert would group with
  // every other notice of the project (offlineQueue keys a group by id, then
  // project_id) and one refusal would drop them all; with an id a re-sent
  // insert that already landed is recognised by its _pkey.
  const writePortalMessage = useCallback((row: Record<string, unknown>): Promise<WriteOutcome> => (
    writePortalMessageOrdered(row.id ? row : { ...row, id: generateUUID() }, {
      projectSyncWaiting: (id) => {
        const p = syncDebounceMap.current.get(id);
        return !!p && !p.inFlight;
      },
      flushProjectSyncs: flushPendingProjectSyncs,
      projectSyncUnconfirmed: (id) => unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).has(id),
      waitProjectSyncSettled: (_id, ms) => new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          projectSyncSettledListenersRef.current.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, ms);
        projectSyncSettledListenersRef.current.add(finish);
      }),
      projectWriteQueued: async (id) => (await ownQueuedProjectIds(userId)).has(id),
      enqueue: (data) => addToOfflineQueue({ table: 'portal_messages', operation: 'insert', data }),
      writeNow: (data, { projectWritePending }) => supabaseWriteDetailed('portal_messages', 'insert', data, {
        describeFailure: (msg, code) => (isPortalLockRefusal(msg, code) ? portalRefusalCopy(projectWritePending) : undefined),
      }),
    })
  ), [flushPendingProjectSyncs, userId]);

  // #82 (wave 4) · The money half of the pass below, on its own: the
  // invoices and AIA pay applications re-read, with the invoices read held —
  // and OWED — while this device has an invoice insert or update on the wire
  // (a read answered before it landed would put the pre-edit row on screen;
  // mergeServerKeepingPending protects queued writes, not ones in flight).
  // Exposed as refetchInvoicesNow for the "client paid" notification paths —
  // never a raw invalidate from there, which would skip this guard — and used
  // by recordInvoicePayment once its append has landed. Resolves when the
  // reads it started have answered (an owed read runs later, on its own).
  // The foreground pass keeps its own copy of this branch (fire-and-forget,
  // beside the settings re-read) — scripts/validate-w4-context-money-portal-
  // publish.ts holds the two guards identical.
  const refetchInvoicesNow = useCallback(async (): Promise<void> => {
    if (!userId) return;
    const reads: Promise<void>[] = [];
    if (invoiceInsertsRef.current.size === 0 && invoiceWritesInFlightRef.current === 0) {
      invoicesReloadOwedRef.current = false;
      reads.push(queryClient.invalidateQueries({ queryKey: ['invoices', userId] }));
    } else {
      invoicesReloadOwedRef.current = true; // #23 round 2: paid when the write reports
    }
    reads.push(queryClient.invalidateQueries({ queryKey: ['aiaPayApps', userId] }));
    await Promise.all(reads);
  }, [queryClient, userId]);
  // #25, part 3: re-read the projects when the app returns to the foreground,
  // so field progress saved while the phone was in a pocket is on screen
  // BEFORE the GC edits (hooks/useProjectsFocusRefetch has the why). Pending
  // debounced syncs go out first, and a projects write still queued skips the
  // refetch — the server-first loader would show the older server row over an
  // offline edit that has not landed; the post-flush listener re-pulls then.
  // The flush fires only entries still waiting on their timer; one whose write
  // is ALREADY on the wire stays in the map (A-8) and is not awaited, and
  // supabaseWrite queues only after a failure — so it is in neither place the
  // queue check looks. Refetching then would put the pre-write server row on
  // screen, and the next edit, built from it, would send the older status /
  // name / collaborators back. Skip while any sync is still unreported (the
  // map or the in-flight set — the flush awaits the writes it fires, so what
  // is left is a write already on the wire, e.g. one the layout's background
  // flush sent, or an edit made since). Review round 2: a skip must not lose
  // the refetch — useProjectsFocusRefetch has already stamped it, so the next
  // one is 30 s and a background away. It is owed instead: the sync's
  // finally (or, for a queued write, the post-flush re-pull) re-reads once
  // the write reports. The loader's pending snapshot is the real guard (#8);
  // this is the belt.
  //
  // #48 / #121: the same return re-reads his money and his profile. A client's
  // Stripe payment is written on the server by stripe-webhook; the invoices
  // list was read at launch and on Home's pull-to-refresh only (5-minute
  // staleTime, no realtime), so he never saw it and the next portal publish
  // went out from the unpaid copy. And payment terms answered on the web were
  // unknown to an iPhone already open, which asked again and replaced them.
  // Each read is skipped while this device still has that kind of write out —
  // an insert or update on the wire, or a terms / profile write queued or in
  // flight — because the server copy would be older than his. A queued
  // invoice edit is safe either way: the loader keeps the device copy of a row
  // with a queued write (mergeServerKeepingPending).
  const refetchMoneyAndProfileOnForeground = useCallback(async (): Promise<void> => {
    if (!userId) return;
    if (invoiceInsertsRef.current.size === 0 && invoiceWritesInFlightRef.current === 0) {
      invoicesReloadOwedRef.current = false;
      void queryClient.invalidateQueries({ queryKey: ['invoices', userId] });
    } else {
      invoicesReloadOwedRef.current = true; // #23 round 2: paid when the write reports
    }
    void queryClient.invalidateQueries({ queryKey: ['aiaPayApps', userId] });
    try {
      const queue = await getOfflineQueue();
      const termsQueued = termsWritesPending(queue, userId);
      const ready = owedSettingsRereadReady({
        owed: true,
        rowWritesInFlight: settingsRowWritesInFlightRef.current,
        termsWritesInFlight: termsWritesInFlightRef.current,
        profilesWriteQueued: settingsRowWritePending(queue, userId) || termsQueued.split || termsQueued.warranty,
      });
      if (ready && liveUserIdRef.current === userId) void queryClient.invalidateQueries({ queryKey: ['settings', userId] });
    } catch { /* an unreadable queue may hold his terms write — skip the re-read */ }
  }, [queryClient, userId]);
  const refetchProjectsOnForeground = useCallback(async (): Promise<void> => {
    await flushPendingProjectSyncs();
    if (unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).size > 0) {
      projectsReloadOwedRef.current = true;
      return;
    }
    if ((await ownQueuedProjectIds(userId)).size > 0) {
      projectsReloadOwedRef.current = true;
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['projects', userId] });
  }, [flushPendingProjectSyncs, queryClient, userId]);
  // (Bound once, with the other foreground re-reads, in refetchAllOnForeground below.)
  // #55 (d): the architect answers through the reply portal while the phone
  // is in a pocket — the RFI and submittal lists loaded at launch (5-minute
  // staleTime, no foreground refetch) and he edited from the 7am copy. Safe
  // with writes queued: the loader keeps the device row of any id with a
  // queued write and leaves out a queued delete (mergeLocalOnly, #112). An
  // INSERT's flush re-pulls through the post-flush listener, which is how the
  // server's number (#148 renumbers every insert) reaches the list.
  const refetchProDocsOnForeground = useCallback(async (): Promise<void> => {
    if (!userId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['rfis', userId] }),
      queryClient.invalidateQueries({ queryKey: ['submittals', userId] }),
      // A sub's "Mark fixed" from the sub portal (#16) is a server-side
      // status + sub_note change; the GC sees Ready for Review on return
      // instead of after a pull-to-refresh. Queued edits keep the device row.
      queryClient.invalidateQueries({ queryKey: ['punchItems', userId] }),
      // #24 (wave 5): a sub submits his prequal packet from the magic link
      // while the phone is in a pocket; the GC reviewed the copy loaded at
      // launch. The loader keeps the device row of a packet with a review
      // write still queued or under Not saved.
      queryClient.invalidateQueries({ queryKey: ['prequalPackets', userId] }),
    ]);
  }, [queryClient, userId]);
  // #23 round 2 (data-session critic) · the rest of the portal-fed lists.
  // The portal writer rebuilds a project's reports, photos, change orders,
  // permits and warranties from THIS device's lists, and a missing item is
  // removed from the portal (#44) — so these were the lists an iPhone read at
  // 07:00 and republished at 19:00 over whatever the GC shared from the web in
  // between. Each loader keeps the device copy of a row with a queued write
  // or one written while the read was out (the CO loader through its own
  // tracker, the others through proDocWriteTouchRef), so re-reading them with
  // edits out is safe. Warranties is not a react-query key; it reloads
  // through its counter.
  const refetchPortalListsOnForeground = useCallback(async (): Promise<void> => {
    if (!userId) return;
    setWarrantiesReload(n => n + 1);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['changeOrders', userId] }),
      queryClient.invalidateQueries({ queryKey: ['dailyReports', userId] }),
      queryClient.invalidateQueries({ queryKey: ['projectPhotos', userId] }),
      queryClient.invalidateQueries({ queryKey: ['permits', userId] }),
    ]);
  }, [queryClient, userId]);
  // ONE foreground binding for every re-read above, so they share one
  // decision (one 30 s gap) and the portal epoch can start first.
  //
  // #23 round 2 · THE RULE: a portal publish may use a list only if that list
  // was read after the latest return to the foreground. The epoch is bumped
  // here, synchronously, BEFORE any re-read starts (each loader captures the
  // epoch its read started in), and portalListsServerRef drops at once so a
  // publish timer that fires before the next render stops too. publishOwned
  // Portals and project-detail then hold until all nine lists answer again.
  // Nothing in this pass waits on another part's guards: each runs on its
  // own; a read skipped for a write still out is owed (projects: the sync's
  // finally / post-flush re-pull; invoices: payInvoicesReloadIfOwed).
  const refetchAllOnForeground = useCallback(async (): Promise<void> => {
    if (!userId) return;
    portalReadEpochRef.current += 1;
    const epoch = portalReadEpochRef.current;
    portalListsServerRef.current = false;
    setPortalServerReads(prev => beginPortalReadEpoch(prev, epoch));
    const parts: (() => Promise<void>)[] = [
      refetchProjectsOnForeground, refetchMoneyAndProfileOnForeground,
      refetchProDocsOnForeground, refetchPortalListsOnForeground,
    ];
    await Promise.all(parts.map(run => run().catch((err) => {
      console.log('[ProjectContext] Foreground re-read failed:', err);
    })));
  }, [userId, refetchProjectsOnForeground, refetchMoneyAndProfileOnForeground, refetchProDocsOnForeground, refetchPortalListsOnForeground]);
  useProjectsFocusRefetch(canSync, refetchAllOnForeground);
  // CONTRACT 24 (wave 5, #150): the same pass, on demand (pull-to-refresh).
  const refreshAll = refetchAllOnForeground;

  // #61 (wave 5, CONTRACT 22) · The server refused a projects DELETE: the job
  // has safety records. It left this phone when the delete was made (and its
  // lists with it); the server still holds all of it. Re-read everything —
  // the projects read waits for the delete's own write to report if it is
  // still out (refetchProjectsOnForeground owes it), and the child lists the
  // foreground pass does not cover are re-read too. Plan data kept only on
  // this phone does not come back; the delete screen's check (deleteProject)
  // is what keeps a refused delete from getting this far.
  useEffect(() => onProjectDeleteRefused((projectId) => {
    if (!userId) return;
    console.log('[ProjectContext] The server kept a job with safety records — re-reading it:', projectId);
    void refetchAllOnForeground().catch(() => {});
    for (const key of ['commitments', 'fieldTickets', 'delayEvents', 'deliveries', 'deliveryReceipts', 'buildingAccess', 'accessReservations', 'cois', 'commEvents', 'subPortalLinks', 'bid_packages', 'bid_package_bids', 'oac_meetings']) {
      void queryClient.invalidateQueries({ queryKey: [key, userId] });
    }
    void refetchPlansRef.current().catch(() => {});
  }), [userId, queryClient, refetchAllOnForeground]);

  // SYNC-F3: after the offline queue drains, re-pull the collections it wrote
  // so an offline-created record is replaced by its server copy and anything
  // the SELECT-before-INSERT race dropped comes back. Pending debounced project
  // syncs go out first so a refetch cannot revert an edit still sitting in
  // the 800 ms window. One listener per provider.
  //
  // A write also leaves the queue when it is DISCARDED (terminal RLS /
  // validation refusal, retry exhaustion) — and a flush with nothing but
  // discards reports no flushed tables, so the optimistic row used to sit in
  // state until some later refetch happened by. The change listener diffs the
  // pending ids on every queue change and re-pulls exactly the tables whose
  // ids vanished (trailing-debounced, and skipping tables the flush listener
  // re-pulled since): the loader's merge keeps a landed row and drops a
  // discarded one, which is neither on the server nor queued any more.
  useEffect(() => {
    let disposed = false;
    const flushedAt = new Map<string, number>();
    const vanishedAt = new Map<string, number>();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let before: Map<string, Set<string>> | null = null;
    let chain: Promise<void> = getOfflineQueue()
      .then((q) => { before = pendingIdsByTable(q); })
      .catch(() => undefined);

    const refetch = async (keys: string[]) => {
      if (keys.includes('projects')) await flushPendingProjectSyncs();
      await Promise.all(keys.map(key => queryClient.invalidateQueries({ queryKey: [key, userId] })));
    };

    const settle = () => {
      settleTimer = null;
      if (disposed) return;
      const due = Array.from(vanishedAt.entries());
      vanishedAt.clear();
      const tables = due.filter(([table, since]) => (flushedAt.get(table) ?? -1) < since).map(([table]) => table);
      // #74: the plan lists are not react-query keys; re-read them directly.
      if (tables.some(t => PLAN_SYNC_TABLES.includes(t))) void refetchPlansRef.current();
      const keys = queryKeysForFlushedTables(tables);
      if (keys.length === 0) return;
      refetch(keys).catch((err) => console.log('[ProjectContext] Post-discard refetch failed:', err));
    };

    const unsubscribeFlushed = onQueueFlushed((tables) => {
      const now = Date.now();
      for (const t of tables) flushedAt.set(t, now);
      // #74: a flushed plan write re-reads the plans (not a react-query key).
      if ([...tables].some(t => PLAN_SYNC_TABLES.includes(t))) void refetchPlansRef.current();
      const keys = queryKeysForFlushedTables(tables);
      if (keys.length === 0) return;
      refetch(keys).catch((err) => console.log('[ProjectContext] Post-flush refetch failed:', err));
    });

    const unsubscribeChanged = onQueueChanged(() => {
      // Stamped NOW, synchronously: the flush listener may run (and re-pull
      // the table) before the async diff below gets to read the queue, and a
      // vanish must compare against the flush by when it was signalled.
      const notifiedAt = Date.now();
      chain = chain.then(async () => {
        if (disposed) return;
        const next = pendingIdsByTable(await getOfflineQueue());
        const prior = before;
        before = next;
        if (!prior) return;
        // A-8: the trailing timer restarts on a VANISH only. Checking the
        // accumulated map instead meant every enqueue after one vanish pushed
        // the settle out again, and a busy device never re-pulled.
        const gone = vanishedPendingIds(prior, next);
        if (gone.size === 0) return;
        for (const table of gone.keys()) vanishedAt.set(table, notifiedAt);
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, 1_500);
      }).catch((err) => console.log('[ProjectContext] Queue diff failed:', err));
    });

    return () => {
      disposed = true;
      if (settleTimer) clearTimeout(settleTimer);
      unsubscribeFlushed();
      unsubscribeChanged();
    };
  }, [queryClient, userId, flushPendingProjectSyncs]);

  const saveProjectsMutationRaw = useMutation({
    mutationFn: async (updatedProjects: Project[]) => { await saveLocal(PROJECTS_KEY, updatedProjects); return updatedProjects; },
    onSuccess: (data) => { queryClient.setQueryData(['projects', userId], data); },
  });
  const saveProjectsMutation = usePortalTrackedSave<Project[]>(saveProjectsMutationRaw, useCallback((next: Project[]) => {
    markPortalDirty(portalDirtyProjects(queryClient.getQueryData<Project[]>(['projects', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const absorbServerSchedule = useCallback((projectId: string, tasks: ScheduleTask[], adopt?: { stamp: string | null; baselines?: readonly unknown[]; activeBaselineId?: string | null }) => {
    const base = projectsRef.current;
    const p = base.find(x => x.id === projectId);
    const prevServer = serverScheduleTasksRef.current.get(projectId);
    serverScheduleTasksRef.current.set(projectId, tasks);
    if (!p?.schedule) return;
    const localTasks = p.schedule.tasks ?? [];
    const whole = !!adopt && !unconfirmedProjectSyncIds(syncDebounceMap.current, inFlightProjectSyncsRef.current).has(projectId);
    const next = whole ? tasks : absorbServerScheduleTasks(prevServer, tasks, localTasks);
    const stamp = whole && adopt?.stamp ? adopt.stamp : p.schedule.updatedAt;
    // Whole means whole: the copy's named baselines too (leftovers review —
    // tasks-only adoption left the store's baselines stale, and any other
    // screen's write of project.schedule then deleted a baseline captured
    // elsewhere, e.g. a CO reflow's "Pre-CO" delay-claim snapshot). A copy
    // without the key (older event shape) leaves them as they were. #86
    // (wave 4): and the ACTIVE baseline id — null clears it (the key is
    // removed), undefined leaves it (utils/projectContextPure has the rule).
    const meta = absorbedScheduleMeta(p.schedule, adopt, whole);
    const baselines = meta.baselines;
    if (JSON.stringify(next) === JSON.stringify(localTasks) && stamp === p.schedule.updatedAt
      && JSON.stringify(baselines) === JSON.stringify(p.schedule.baselines)
      // An event that changes only the active baseline is not a no-op (#86).
      && meta.activeBaselineId === p.schedule.activeBaselineId) return;
    // A local write for the loader's purposes: a load already out read the
    // row before this event and must not take the value back.
    noteProjectWrite(projectWriteLogRef.current, projectId);
    const updated = base.map(x => x.id === projectId && x.schedule
      ? { ...x, schedule: withActiveBaselineId({ ...x.schedule, tasks: next, updatedAt: stamp, baselines }, meta.activeBaselineId) }
      : x);
    projectsRef.current = updated;
    setProjects(updated);
    // The RAW save: a copy that came from the server is not a local write, so
    // it never marks the project's portal for a republish (#23).
    saveProjectsMutationRaw.mutate(updated);
  // Kept stable for StableActionsContext: the mutation's `mutate` is stable,
  // and everything else is read through refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveChangeOrdersMutationRaw = useMutation({
    mutationFn: async (updated: ChangeOrder[]) => { await saveLocal(CHANGE_ORDERS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['changeOrders', userId], data); },
  });
  const saveChangeOrdersMutation = usePortalTrackedSave<ChangeOrder[]>(saveChangeOrdersMutationRaw, useCallback((next: ChangeOrder[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<ChangeOrder[]>(['changeOrders', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const saveInvoicesMutationRaw = useMutation({
    mutationFn: async (updated: Invoice[]) => { await saveLocal(INVOICES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['invoices', userId], data); },
  });
  const saveInvoicesMutation = usePortalTrackedSave<Invoice[]>(saveInvoicesMutationRaw, useCallback((next: Invoice[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<Invoice[]>(['invoices', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const saveCommitmentsMutation = useMutation({
    mutationFn: async (updated: Commitment[]) => { await saveLocal(COMMITMENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['commitments', userId], data); },
  });
  const savePrequalMutation = useMutation({
    mutationFn: async (updated: PrequalPacket[]) => { await saveLocal(PREQUAL_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['prequalPackets', userId], data); },
  });
  const saveDailyReportsMutationRaw = useMutation({
    mutationFn: async (updated: DailyFieldReport[]) => { await saveLocal(DAILY_REPORTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['dailyReports', userId], data); },
  });
  const saveDailyReportsMutation = usePortalTrackedSave<DailyFieldReport[]>(saveDailyReportsMutationRaw, useCallback((next: DailyFieldReport[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<DailyFieldReport[]>(['dailyReports', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const saveFieldTicketsMutation = useMutation({
    mutationFn: async (updated: FieldTicket[]) => { await saveLocal(FIELD_TICKETS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['fieldTickets', userId], data); },
  });
  const saveDelayEventsMutation = useMutation({
    mutationFn: async (updated: DelayEvent[]) => { await saveLocal(DELAY_EVENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['delayEvents', userId], data); },
  });
  const saveSubsMutation = useMutation({
    mutationFn: async (updated: Subcontractor[]) => { await saveLocal(SUBS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['subcontractors', userId], data); },
  });
  const saveLeadsMutation = useMutation({
    mutationFn: async (updated: Lead[]) => { await saveLocal(LEADS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['leads', userId], data); },
  });
  const saveBidPackagesMutation = useMutation({
    mutationFn: async (updated: BidPackage[]) => { await saveLocal(BID_PACKAGES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['bid_packages', userId], data); },
  });
  const saveBidPackageBidsMutation = useMutation({
    mutationFn: async (updated: BidPackageBid[]) => { await saveLocal(BID_PACKAGE_BIDS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['bid_package_bids', userId], data); },
  });
  const savePunchItemsMutationRaw = useMutation({
    mutationFn: async (updated: PunchItem[]) => { await saveLocal(PUNCH_ITEMS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['punchItems', userId], data); },
  });
  const savePunchItemsMutation = usePortalTrackedSave<PunchItem[]>(savePunchItemsMutationRaw, useCallback((next: PunchItem[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<PunchItem[]>(['punchItems', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const savePhotosMutationRaw = useMutation({
    mutationFn: async (updated: ProjectPhoto[]) => { await saveLocal(PHOTOS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['projectPhotos', userId], data); },
  });
  const savePhotosMutation = usePortalTrackedSave<ProjectPhoto[]>(savePhotosMutationRaw, useCallback((next: ProjectPhoto[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<ProjectPhoto[]>(['projectPhotos', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const savePriceAlertsMutation = useMutation({
    mutationFn: async (updated: PriceAlert[]) => { await saveLocal(PRICE_ALERTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['priceAlerts', userId], data); },
  });
  const saveContactsMutation = useMutation({
    mutationFn: async (updated: Contact[]) => { await saveLocal(CONTACTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['contacts', userId], data); },
  });
  const saveCommEventsMutation = useMutation({
    mutationFn: async (updated: CommunicationEvent[]) => { await saveLocal(COMM_EVENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['commEvents', userId], data); },
  });
  const saveRfisMutationRaw = useMutation({
    mutationFn: async (updated: RFI[]) => { await saveLocal(RFIS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['rfis', userId], data); },
  });
  const saveRfisMutation = usePortalTrackedSave<RFI[]>(saveRfisMutationRaw, useCallback((next: RFI[]) => {
    markPortalDirty(portalDirtyProjectIds(queryClient.getQueryData<RFI[]>(['rfis', userId]), next));
  }, [queryClient, userId, markPortalDirty]));
  const saveSubmittalsMutation = useMutation({
    mutationFn: async (updated: Submittal[]) => { await saveLocal(SUBMITTALS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['submittals', userId], data); },
  });
  const saveOACMeetingsMutation = useMutation({
    mutationFn: async (updated: OACMeeting[]) => { await saveLocal(OAC_MEETINGS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['oac_meetings', userId], data); },
  });
  const saveCOIsMutation = useMutation({
    mutationFn: async (updated: CertificateOfInsurance[]) => { await saveLocal(COIS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['cois', userId], data); },
  });
  const saveEquipmentMutation = useMutation({
    mutationFn: async (updated: Equipment[]) => { await saveLocal(EQUIPMENT_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['equipment', userId], data); },
  });
  const saveSettingsMutation = useMutation({
    mutationFn: async (updatedSettings: AppSettings) => {
      // Every caller counted this save in settingsRowWritesInFlightRef BEFORE
      // mutate (finding 15, round 3): counted only here, after the device
      // write below, a settings read starting in that gap saw nothing in
      // flight, and — the PATCH settling before the GET was judged — committed
      // the pre-edit row, which his next save then sent back. Released exactly
      // once: when the server write settles, or here if none goes out.
      const releaseOwner = userId;
      let handedOff = false;
      try {
        // Belt for finding 13 / 14: a whole-row write is only ever built from
        // THIS account's loaded settings. Before the load `updatedSettings` is
        // DEFAULT plus one change, and this row write would send blank contact
        // details, 10 % contingency and 'United States' over his real row.
        // updateSettings holds pre-load edits and never gets here with one;
        // this refuses any future caller that does.
        if (settingsLoadedForRef.current !== settingsOwnerKey) return updatedSettings;
        // The device copy is the LATEST settings, not this mutation's argument:
        // a save that resolves after savePaymentTerms must not write the older
        // object (without the new terms) back to disk.
        await saveLocal(SETTINGS_KEY, settingsRef.current);
        if (canSync && userId) {
          // This payload NEVER carries deposit_pct / progress_pct / final_pct /
          // warranty_months: it is built from whatever settings object the
          // caller held, and a stale one would erase an answer given on another
          // screen or device. Those columns have their own write (savePaymentTerms).
          // Through the offline queue — the previous direct .update() swallowed
          // offline failures, so branding/digest/settings edits made offline
          // silently never reached the server (and reverted on next launch).
          // Counted while on the wire (supabaseWrite tries the network before
          // it queues): a settings read that overlaps it must not let the
          // pre-write row win (finding 15). When the last one settles, the
          // re-read a raced load owed can run.
          const write = supabaseWrite('profiles', 'update', {
            id: userId,
            location: updatedSettings.location, units: updatedSettings.units,
            tax_rate: updatedSettings.taxRate, contingency_rate: updatedSettings.contingencyRate,
            company_name: updatedSettings.branding.companyName, contact_name: updatedSettings.branding.contactName,
            email: updatedSettings.branding.email, phone: updatedSettings.branding.phone,
            address: updatedSettings.branding.address, license_number: updatedSettings.branding.licenseNumber,
            // NEEDS 20260917120000_profile_license_fields.sql ON THE SERVER
            // FIRST: PostgREST refuses an unknown column for the whole update,
            // and this one write carries every settings field. Both values go
            // through the column normalisers — the CHECK / date cast would
            // otherwise fail the whole row as well. Blank → NULL ("not told").
            license_state: licenceStateColumnValue(updatedSettings.branding.licenseState),
            license_expiry: licenceExpiryColumnValue(updatedSettings.branding.licenseExpiry),
            tagline: updatedSettings.branding.tagline, logo_uri: updatedSettings.branding.logoUri,
            signature_data: updatedSettings.branding.signatureData, theme_colors: updatedSettings.themeColors,
            biometrics_enabled: updatedSettings.biometricsEnabled, dfr_recipients: updatedSettings.dfrRecipients,
            digest_enabled: updatedSettings.digest?.enabled ?? false,
            digest_hour: updatedSettings.digest?.hour ?? 6,
            digest_channels: updatedSettings.digest?.channels ?? { email: true, in_app: true },
            digest_timezone: updatedSettings.digest?.timezone ?? 'America/New_York',
            financing: updatedSettings.financing ?? null,
          });
          handedOff = true;
          void write.finally(() => {
            settingsRowWritesInFlightRef.current -= 1;
            if (releaseOwner) void runOwedSettingsReread(releaseOwner);
          });
        }
        return updatedSettings;
      } finally {
        if (!handedOff) {
          settingsRowWritesInFlightRef.current -= 1;
          if (releaseOwner) void runOwedSettingsReread(releaseOwner);
        }
      }
    },
    // settingsRef.current, not the mutation's argument: the cache must never
    // step back to an older settings object than the one on screen. Tagged at
    // the current write sequence, so the data effect may commit it.
    onSuccess: () => {
      if (settingsLoadedForRef.current !== settingsOwnerKey) return;
      const latest = settingsRef.current;
      settingsDataSeqRef.current.set(latest, settingsWriteSeqRef.current);
      queryClient.setQueryData(['settings', userId], latest);
    },
  });

  // Geocode a project's location string into lat/lng for hyperlocal weather
  // (morning digest, schedule weather alerts). Best-effort and async — never
  // blocks save. Updates the project in-place once Nominatim resolves.
  const geocodeIfNeeded = useCallback((project: Project) => {
    const hasCoords = project.locationLatitude != null && project.locationLongitude != null;
    if (!shouldGeocode(undefined, project.location, hasCoords, project.locationGeocodedAt)) return;
    void geocodeProjectLocation(project.location).then(result => {
      if (!result) return;
      // Re-read from current state at resolve-time so we don't overwrite a
      // concurrent edit. setProjects gets the latest snapshot via the
      // function setter.
      setProjects(prev => {
        const next = prev.map(p => p.id === project.id ? {
          ...p,
          locationLatitude: result.latitude,
          locationLongitude: result.longitude,
          locationGeocodedAt: new Date().toISOString(),
        } : p);
        // Persist + sync
        saveProjectsMutation.mutate(next);
        const updated = next.find(p => p.id === project.id);
        // Coordinates only — never a schedule this device may hold stale (#25).
        if (updated) syncProjectToSupabase(updated, 'upsert', { changedKeys: ['locationLatitude', 'locationLongitude', 'locationGeocodedAt'] });
        return next;
      });
    }).catch(() => { /* silent — falls back to no-coords path */ });
  }, [saveProjectsMutation, syncProjectToSupabase]);

  const addProject = useCallback((incoming: Project) => {
    // A-1: the creator owns what they create. Stamps ownerUserId and drops the
    // loader's per-load stamps that a clone of a SHARED project (home →
    // duplicate) carries in from its source — with the other owner's id the
    // new row was PATCHed by an id the server had never seen and never landed.
    // With every creation path stamping the owner, a project with NO
    // ownerUserId can only be a cache predating the field (classifyProjectForSync).
    const project = claimProjectForUser(incoming, userId);
    const updated = [project, ...projects];
    // Activation funnel: fire once at the imperative create (never on hydration,
    // which replaces `projects` via the query, not through addProject).
    track(AnalyticsEvents.PROJECT_CREATED, {
      total_projects: updated.length,
      type: project.type,
      has_estimate: !!project.linkedEstimate,
      is_first_project: updated.length === 1,
    });
    if (project.linkedEstimate || project.status === 'estimated') {
      // receipts / laborSamples / seeds are not available in ProjectContext's
      // scope — buildCostDatabase is called with the data that IS here
      // (projects + commitments). Grounding reflects closed-job history only —
      // a seed-only user (rates seeded, no closed jobs) reads used_learned_costs
      // false on THIS path. Accepted v1 undercount; the wizard emit carries full
      // grounding (incl. seeds) and is the primary aha signal.
      const _db = buildCostDatabase(updated, commitments);
      track(AnalyticsEvents.ESTIMATE_GENERATED, {
        project_type: project.type,
        grand_total: project.linkedEstimate?.grandTotal,
        path: 'created_with_estimate',
        ...estimateGroundingProps(_db),
      });
    }
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    // Immediate (non-debounced) so the project row exists in Supabase before any
    // sub-collections a caller adds next (fixes the demo-seeder FK failures +
    // the "new project vanishes on reload" bug).
    syncProjectToSupabase(project, 'upsert', { immediate: true });
    geocodeIfNeeded(project);
    if (canSync && userId) {
      void import('@/utils/qboSync').then(m => m.triggerQboSync('project', 'upsert', project.id));
    }
    // #4 (wave 4): how the job's create write ended, for a caller (the sample
    // seeder) that wants to know. No caller HAS to wait on it: a child created
    // in the same instant (the seeder writes 23 of them in this tick) used to
    // reach PostgREST before the job row committed, be refused by RLS / the
    // FK, and vanish. utils/offlineQueue now orders them — the upsert above
    // takes the job's slot synchronously, and each child's direct write takes
    // its OWN slot at the call and then waits on the job's, so it goes out
    // after the job has landed; if the job fell into the queue, the child's
    // refusal is queued behind it (the #4 backstop) and the flush sends
    // projects first. That is why every child add* hands its INSERT to
    // supabaseWrite in the same tick and never awaits this first: waiting
    // here left the child's slot free, and an edit of it made meanwhile went
    // out ahead of its INSERT (0 rows, lost).
    return projectCreateWritesRef.current.get(project.id) ?? Promise.resolve<WriteOutcome>(canSync ? 'synced' : 'failed');
  }, [projects, saveProjectsMutation, syncProjectToSupabase, geocodeIfNeeded, canSync, userId]);

  const updateProject = useCallback((id: string, rawUpdates: Partial<Project>) => {
    const base = projectsRef.current;
    const prior = base.find(p => p.id === id);
    const nowISO = new Date().toISOString();
    // #25, second writer: a schedule edit is often built from a screen's
    // working copy loaded long before the foreman's field update the refetch
    // brought into projectsRef. stampFieldEdits keeps his newer progress /
    // status / notes / actuals where this edit did not really change them and
    // stamps the ones it did, so the server trigger (20260917160000) lets a
    // real owner change through and this screen shows what the server keeps.
    const updates: Partial<Project> = rawUpdates.schedule?.tasks
      ? { ...rawUpdates, schedule: { ...rawUpdates.schedule, tasks: stampFieldEdits(prior?.schedule?.tasks, rawUpdates.schedule.tasks, nowISO) } }
      : rawUpdates;
    const updated = base.map(p => p.id === id ? { ...p, ...updates, updatedAt: nowISO } : p);
    projectsRef.current = updated;
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    const proj = updated.find(p => p.id === id);
    // Activation funnel: a project crossing INTO 'estimated' is the moat's
    // first "aha" — fire once on the transition, not on every estimate re-save.
    if (proj && prior?.status !== 'estimated' && proj.status === 'estimated') {
      // receipts / laborSamples / seeds are not available in ProjectContext's
      // scope — buildCostDatabase is called with the data that IS here
      // (projects + commitments). Grounding reflects closed-job history only —
      // a seed-only user (rates seeded, no closed jobs) reads used_learned_costs
      // false on THIS path. Accepted v1 undercount; the wizard emit carries full
      // grounding (incl. seeds) and is the primary aha signal.
      const _db = buildCostDatabase(updated, commitments);
      track(AnalyticsEvents.ESTIMATE_GENERATED, {
        project_type: proj.type,
        grand_total: proj.linkedEstimate?.grandTotal,
        path: 'linked_to_project',
        ...estimateGroundingProps(_db),
      });
    }
    if (proj) {
      // The update's own keys: only a write that touched the schedule sends it.
      syncProjectToSupabase(proj, 'upsert', { changedKeys: Object.keys(rawUpdates) });
      // Re-geocode only if the location string actually changed — avoids
      // hitting Nominatim's rate limit on every routine save (e.g.
      // schedule debounce flush).
      if (prior?.location !== proj.location) {
        geocodeIfNeeded(proj);
      }
    }
  }, [commitments, saveProjectsMutation, syncProjectToSupabase, geocodeIfNeeded]);

  // deleteProject is defined further down (just before the bucket memos) so it
  // can reference every project-scoped collection's persist fn / mutation for a
  // full local cascade. Those persist helpers (persistWarranties, persistPlan*,
  // persistPermitRoadmaps, persistPortalMessages) are declared later in this
  // component body, so defining the cascade here would hit their temporal dead
  // zone in the dependency array. See the `deleteProject` below.

  const getProject = useCallback((id: string) => projects.find(p => p.id === id) ?? null, [projects]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    // Not loaded yet: `settingsRef` is DEFAULT, and the save writes the WHOLE
    // profiles row. Hold only what this call CHANGES relative to what the
    // screen was showing (a screen that rebuilds `branding` from blank fields
    // changes one of them, not all); it is written merged onto the real row,
    // one level deep, when that lands (see the effect below). The held edit
    // is shown at once, so the control he touched does not snap back.
    if (settingsLoadedForRef.current !== settingsOwnerKey) {
      const held = heldSettingsPatch(settingsRef.current, updates);
      pendingSettingsUpdatesRef.current = mergeHeldPatches(pendingSettingsUpdatesRef.current, held);
      commitSettingsState(applyHeldSettings(settingsRef.current, held));
      return;
    }
    const updated = { ...settingsRef.current, ...updates };
    commitSettingsState(updated);
    settingsWriteSeqRef.current += 1;
    // In flight from THIS moment (the mutation releases it) — see its note.
    settingsRowWritesInFlightRef.current += 1;
    saveSettingsMutation.mutate(updated);
    markPortalDirty(['*']); // the profile heads every portal (#23)
  }, [commitSettingsState, saveSettingsMutation, settingsOwnerKey, markPortalDirty]);
  useEffect(() => {
    const pending = pendingSettingsUpdatesRef.current;
    if (!settingsLoaded || !pending) return;
    pendingSettingsUpdatesRef.current = null;
    const merged = applyHeldSettings(settingsRef.current, pending);
    commitSettingsState(merged);
    settingsWriteSeqRef.current += 1;
    settingsRowWritesInFlightRef.current += 1;
    saveSettingsMutation.mutate(merged);
    markPortalDirty(['*']); // the profile heads every portal (#23)
  }, [settingsLoaded, commitSettingsState, saveSettingsMutation, markPortalDirty]);

  const savePaymentTerms = useCallback((input: { split?: PaymentSplit; warrantyMonths?: number }): boolean => {
    // Validated against the CHECK before anything moves: a violation is
    // terminal in the offline queue, and an answer shown as saved that the
    // server then drops is worse than a refusal the sheet can explain.
    const cols = termsColumnsForWrite(input);
    if ('refused' in cols || (!cols.split && !cols.warranty)) return false;
    // Before the load, settingsRef is DEFAULT: saving `next` to the device
    // cache would overwrite his branding there. The gate refuses to open in
    // that window, so this is the belt.
    if (settingsLoadedForRef.current !== settingsOwnerKey) return false;
    const next: AppSettings = { ...settingsRef.current };
    if (cols.split) {
      next.paymentSplit = { depositPct: cols.split.deposit_pct, progressPct: cols.split.progress_pct, finalPct: cols.split.final_pct };
    }
    if (cols.warranty) next.warrantyMonths = cols.warranty.warranty_months;
    markPortalDirty(['*']); // terms show on every proposal portal (#23)
    commitSettingsState(next);
    settingsWriteSeqRef.current += 1;
    void saveLocal(SETTINGS_KEY, next);
    settingsDataSeqRef.current.set(next, settingsWriteSeqRef.current);
    queryClient.setQueryData(['settings', userId], next);
    if (canSync && userId) {
      const writeUserId: string = userId;
      const track = (write: Promise<boolean>) => {
        termsWriteEpochRef.current += 1;
        termsWritesInFlightRef.current += 1;
        void write.finally(() => {
          termsWritesInFlightRef.current -= 1;
          void runOwedSettingsReread(writeUserId);
        });
      };
      if (cols.split) {
        track(supabaseWrite('profiles', 'update', { id: userId, deposit_pct: cols.split.deposit_pct, progress_pct: cols.split.progress_pct, final_pct: cols.split.final_pct }));
      }
      if (cols.warranty) {
        track(supabaseWrite('profiles', 'update', { id: userId, warranty_months: cols.warranty.warranty_months }));
      }
    }
    return true;
  }, [commitSettingsState, queryClient, userId, canSync, settingsOwnerKey, runOwedSettingsReread, markPortalDirty]);

  const addCollaborator = useCallback((projectId: string, collab: ProjectCollaborator) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const existing = project.collaborators ?? [];
    if (existing.some(c => c.email === collab.email)) return;
    updateProject(projectId, { collaborators: [...existing, collab] });
  }, [projects, updateProject]);

  const removeCollaborator = useCallback((projectId: string, collabId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    updateProject(projectId, { collaborators: (project.collaborators ?? []).filter(c => c.id !== collabId) });
  }, [projects, updateProject]);

  // ─── Portal-state default helper ───────────────────────────────────────────
  // Tier 1 (CO / Invoice / AIA Pay App / RFI / Submittal): always Draft —
  //   explicit Send required before the client can see it.
  // Tier 2 (Daily Report / Photo / Warranty): Sent unless the project's
  //   per-type autoShare toggle is explicitly false. Undefined = true
  //   (preserves existing behaviour — items created before the portal toggle
  //   was introduced continue to appear in the portal automatically).
  // Selection is deferred — its state lives outside ProjectContext (T5 notes).
  const initialPortalState = useCallback(
    (kind: SendableItemKind, projectId: string): PortalState => {
      // Tier 1 — always Draft
      if (
        kind === 'change_order' || kind === 'invoice' || kind === 'aia_pay_app' ||
        kind === 'rfi' || kind === 'submittal'
      ) {
        return { status: 'draft' };
      }
      // Tier 2 — Sent unless the per-project autoShare toggle for this type
      // is explicitly set to false. Undefined/missing = true.
      const proj = projects.find(p => p.id === projectId);
      // #59 interim: a field / viewer seat's report or photo is a draft on the
      // server whatever autoShare says (the GC reviews it first) — the phone
      // says so too, instead of "Sent" until the next read.
      if (fieldSeatCreatesDraft(kind, proj?.myRole)) return { status: 'draft' };
      const auto = proj?.clientPortal?.autoShare ?? {};
      const enabledFor: Record<Exclude<SendableItemKind, 'change_order' | 'invoice' | 'aia_pay_app' | 'rfi' | 'submittal'>, boolean> = {
        daily_report: auto.dailyReports !== false,
        photo:        auto.photos       !== false,
        selection:    auto.selections   !== false,
        warranty:     auto.warranties   !== false,
      };
      const enabled = (enabledFor as Record<string, boolean | undefined>)[kind] ?? true;
      if (enabled) {
        return { status: 'sent', sentAt: new Date().toISOString(), sentVersion: 1 };
      }
      return { status: 'draft' };
    },
    [projects],
  );

  // Snake/camel mapping for the change_orders row — every column an EDIT may
  // change. ONE builder for insert and update so the two payloads cannot drift
  // (the insert-only columns are added at the insert site).
  //
  // WHY THIS EXISTS. The insert used to hand-list its columns and omitted ALL
  // FOUR schedule_* columns; the update wrote only schedule_impact_days and
  // schedule_impact_applied. schedule_impact_task_ids / schedule_anchor_task_id
  // were written by nothing and read by nothing anywhere in the repo, despite
  // migration 20260803150000 adding them so "the anchor survives a device
  // swap".
  //
  // What the user saw: a CO created with "+5 days" lost the days on the first
  // server-first refetch (app restart, or past react-query's staleTime), so
  // scheduleImpactDays hydrated as undefined; approving it then ran
  // normalizeImpactDays(undefined) → 0 → 'no_impact' and NOTHING on the Gantt
  // moved. The owner had signed off on the extension, the CO PDF dropped its
  // Schedule Impact row, and the contractual time-extension entitlement was
  // absent from the server row entirely. Losing scheduleAnchorTaskId meant the
  // task the GC picked to absorb the days had to be picked again on every
  // device.
  //
  // schedule_impact_applied is NOT the authoritative "already reflowed" signal
  // — audit_trail is (utils/coScheduleReflowCore.isCoScheduleReflowApplied
  // checks the CO_REFLOW_ACTION marker first), and every new audit entry
  // reaches the server through co_append_audit, so mirroring the local boolean
  // cannot cause a double-apply.
  //
  // audit_trail is NOT a column of this row (#40). It is written whole only by
  // the INSERT (the CO's first entries); every later entry is APPENDED on the
  // server (appendCoAudit). Writing the column whole from the device erased
  // the sealed e-signature entry the portal's signing RPC appends server-side
  // — the portal reconciler did it within 90 seconds of every signature.
  //
  // The frozen tax columns (#131) ride only when the CO holds them
  // (utils/projectContextPure.changeOrderTaxColumns).
  const changeOrderToRow = useCallback((co: ChangeOrder) => ({
    id: co.id, project_id: co.projectId, number: co.number, date: co.date,
    description: co.description, reason: co.reason, line_items: co.lineItems,
    original_contract_value: co.originalContractValue, change_amount: co.changeAmount,
    new_contract_total: co.newContractTotal, status: co.status,
    approvers: co.approvers, approval_mode: co.approvalMode,
    approval_deadline_days: co.approvalDeadlineDays,
    revision: co.revision, updated_at: co.updatedAt,
    schedule_impact_days: co.scheduleImpactDays ?? null,
    schedule_impact_applied: co.scheduleImpactApplied ?? false,
    schedule_impact_task_ids: co.scheduleImpactTaskIds ?? null,
    schedule_anchor_task_id: co.scheduleAnchorTaskId ?? null,
    ...changeOrderTaxColumns(co),
    // #73: the declined CO this one revises. Only when set, like
    // source_photo_id: the column is new (20260920050000), and naming it on
    // every CO write would stall them all on a server without it.
    ...(co.revisesChangeOrderId ? { revises_change_order_id: co.revisesChangeOrderId } : {}),
  }), []);

  // #40 · Audit entries not yet appended on the server, by CO (the refs are
  // declared at the top). An append that could not go out (offline, the CO's
  // own row not on the server yet, a transient error) waits and goes with the
  // next edit of that CO, the next change_orders queue flush, or the next
  // launch; co_append_audit skips ids already present, so a retry can never
  // double an entry. A refusal is final only when it can mean nothing but
  // "not his CO" (#40 wave 4: a live bearer, and no insert or queued write of
  // the CO that could explain a missing row).
  //
  // DURABLE. The map is written to CO_AUDIT_PENDING_KEY BEFORE the edit's
  // UPDATE goes out or is queued (updateChangeOrder awaits stashCoAudit), and
  // read back when the account resolves. Held only in memory, an offline edit
  // lost its entries when the app was killed: the queued UPDATE (which no
  // longer carries audit_trail) landed on the next launch, the loader took the
  // server row, and the in-person signature or a "place these days" marker
  // was gone from the server AND the device. Writes are chained so an older
  // snapshot of the map can never land after a newer one.
  const coAuditPersistChainRef = useRef<Promise<void>>(Promise.resolve());
  const persistCoAuditPending = useCallback((): Promise<void> => {
    const run = async () => {
      await coAuditLoadRef.current;
      const owner = coAuditOwnerRef.current;
      if (!owner) return;
      await saveLocal(CO_AUDIT_PENDING_KEY, { owner, pending: Object.fromEntries(pendingCoAuditRef.current) });
    };
    const next = coAuditPersistChainRef.current.then(run, run);
    coAuditPersistChainRef.current = next.catch(() => {});
    return next.catch(() => {});
  }, []);
  const stashCoAudit = useCallback(async (coId: string, entries: readonly COAuditEntry[]): Promise<void> => {
    if (entries.length === 0) return;
    await coAuditLoadRef.current;
    const merged = newAuditEntries([], [...(pendingCoAuditRef.current.get(coId) ?? []), ...entries]);
    pendingCoAuditRef.current.set(coId, merged);
    await persistCoAuditPending();
  }, [persistCoAuditPending]);
  const appendCoAudit = useCallback(async (coId: string, entries: readonly COAuditEntry[]): Promise<void> => {
    await stashCoAudit(coId, entries);
    // #40 wave 4: the CO's INSERT is still on the wire — its row may not exist
    // yet, and co_denied for a missing row would be taken as final. Wait: the
    // edit that is waiting on that insert appends once it reports 'synced'.
    if (changeOrderInsertsRef.current.has(coId)) return;
    const all = pendingCoAuditRef.current.get(coId) ?? [];
    for (const batch of chunkForAppend(all)) {
      let refused = false;
      beginCoWrite(coId);
      try {
        // Read BEFORE the call (as the loaders do): a request sent while the
        // token had no runway goes out with the anon key, which has no
        // EXECUTE — its 42501 says nothing about this CO.
        let bearerBefore = false;
        try { bearerBefore = !!bearerTokenForRead((await supabase.auth.getSession()).data?.session, Date.now()); } catch { /* no bearer */ }
        const { error } = await supabase.rpc('co_append_audit', { p_co_id: coId, p_entries: batch });
        if (error) {
          const kind = classifyCoAuditError(error);
          if (kind === 'transient') return; // stays pending
          if (kind === 'row_or_session') {
            // co_denied / 42501 is final only for a live bearer AND a CO known
            // to be on the server (coAuditRefusalIsFinal). An unreadable queue
            // counts as holding a write of it — keeping is never wrong.
            // A write of it refused and parked in the sync ledger (CONTRACT 1)
            // counts too: a failed INSERT there is resent from the sync badge
            // with its creation-time audit_trail, so dropping these entries
            // now would lose them for good (context-records review, #40).
            let queued = true;
            try {
              queued = (await queuedIdsFor('change_orders')).has(coId)
                || (await unsavedWriteIds('change_orders')).has(coId);
            } catch { /* keep */ }
            const final = coAuditRefusalIsFinal({
              bearerBefore, bearerAfter: await bearerStillLive(),
              insertInFlight: changeOrderInsertsRef.current.has(coId), queued,
            });
            if (!final) return; // stays pending — retried on the next flush, edit or launch
          }
          refused = true;
        }
      } catch {
        return; // network — stays pending
      } finally {
        endCoWrite(coId);
      }
      if (refused) console.warn('[CO audit] append refused for', coId, '— not appended on the server');
      // Only what THIS batch carried leaves the pending list: an append that
      // started meanwhile keeps its entries until its own call reports.
      const sent = new Set(batch.map(e => e.id));
      const rest = (pendingCoAuditRef.current.get(coId) ?? []).filter(e => !sent.has(e.id));
      if (rest.length) pendingCoAuditRef.current.set(coId, rest);
      else pendingCoAuditRef.current.delete(coId);
      await persistCoAuditPending();
    }
  }, [stashCoAudit, persistCoAuditPending, beginCoWrite, endCoWrite]);
  // Retry every owed append whose CO has nothing left in the queue. A CO whose
  // INSERT (or UPDATE) is still queued waits: co_append_audit refuses a row it
  // cannot find as co_denied, which is final, so appending ahead of the insert
  // would drop the entries for good.
  const retryPendingCoAudit = useCallback(async (): Promise<void> => {
    await coAuditLoadRef.current;
    if (!canSync || pendingCoAuditRef.current.size === 0) return;
    let queued: Set<string>;
    // Ledger-parked writes wait too (#40): see appendCoAudit.
    try { queued = new Set([...await queuedIdsFor('change_orders'), ...await unsavedWriteIds('change_orders')]); } catch { return; }
    for (const coId of [...pendingCoAuditRef.current.keys()]) {
      // #40 wave 4: nor one whose INSERT is still on the wire (a mic-drafted CO
      // on a weak link) — updateChangeOrder appends once that insert reports.
      if (!queued.has(coId) && !changeOrderInsertsRef.current.has(coId)) void appendCoAudit(coId, []);
    }
  }, [canSync, appendCoAudit]);
  const retryPendingCoAuditRef = useRef(retryPendingCoAudit);
  retryPendingCoAuditRef.current = retryPendingCoAudit;
  useEffect(() => onQueueFlushed((tables) => {
    if (!tables.has('change_orders')) return;
    void retryPendingCoAudit();
  }), [retryPendingCoAudit]);
  // DISCARD from the Not-saved sheet (integration round 1). Two things the
  // ledger cannot do on its own:
  //  • a discarded change-order write takes the audit entries stashed with it.
  //    retryPendingCoAudit waits only while the CO is in the ledger; once the
  //    line is gone it appended them — a 'marked_approved' reached the server
  //    trail for a status change that was thrown away. Integration round 2:
  //    by id, not by time. Each edit's entries ride its write (`rides`, carried
  //    onto the line and unioned when a later edit folds into it) and exactly
  //    those go. A discarded CREATE takes every owed entry of the CO: the row
  //    will not exist, so none of them has anywhere to land. Round 1 kept
  //    entries stamped before (first discarded write − 2 s) — but the write is
  //    stamped when it is sent, and an approval that waited on the CO's
  //    INSERT for longer than that kept its 'marked_approved'. Owed entries
  //    of an edit that DID land ride no discarded line and stay.
  //  • the confirm says "this phone goes back to [MAGE's copy]": the table's
  //    list is re-read, so it does — no longer kept by the ledger, the device
  //    row gives way to the server's.
  // The lists a Not-saved line's table lives in — re-read after a Discard (the
  // phone goes back to MAGE's copy) or a Retry that took lines off the sheet
  // (the phone shows what landed). Invoices through refetchInvoicesNow, never
  // a raw invalidate (it holds the read while an invoice write is on the
  // wire). project_financials is the projects list's money (integration round
  // 3 — its Discard re-read nothing); profiles is the settings read.
  const rereadLedgerTables = useCallback((tables: ReadonlySet<string>) => {
    if (!userId) return;
    const KEY_FOR_TABLE: Record<string, string> = {
      projects: 'projects', project_financials: 'projects', change_orders: 'changeOrders', commitments: 'commitments',
      daily_reports: 'dailyReports', field_tickets: 'fieldTickets', punch_items: 'punchItems', photos: 'projectPhotos',
      rfis: 'rfis', submittals: 'submittals', permits: 'permits', aia_pay_apps: 'aiaPayApps',
      delay_events: 'delayEvents', deliveries: 'deliveries', profiles: 'settings',
    };
    const keys = new Set<string>();
    for (const table of tables) {
      if (table === 'warranties') { setWarrantiesReload((n) => n + 1); continue; }
      if (table === 'invoices') { void refetchInvoicesNow().catch(() => {}); continue; }
      const key = KEY_FOR_TABLE[table];
      if (key) keys.add(key);
    }
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key, userId] });
  }, [userId, queryClient, refetchInvoicesNow]);
  useEffect(() => onUnsavedDiscarded((discarded) => {
    const tables = new Set<string>();
    const coDrops = coAuditDropsForDiscard(discarded);
    for (const f of discarded) if (f.table) tables.add(f.table);
    // #1 (wave 5): a discarded CREATE of a job the server never confirmed
    // (a refused create, or a job that was only on this phone) — "the phone
    // goes back to MAGE's copy", and MAGE has none. The projects loader keeps
    // every local-only job, so without this the job stayed, and the next load
    // wrote its line again. Only once the confirmed set is known: an edit
    // line of a job that IS on the server never removes it.
    if (serverIdsSeededRef.current) {
      const gone = new Set<string>();
      for (const f of discarded) {
        if (f.table !== 'projects' || !f.recordId || (f.operation !== 'insert' && f.operation !== 'upsert')) continue;
        if (f.userId && f.userId !== liveUserIdRef.current) continue;
        if (!serverProjectIdsRef.current.has(f.recordId)) gone.add(f.recordId);
      }
      if (gone.size > 0) dropLocalOnlyJobsRef.current(gone);
    }
    if (coDrops.size > 0) {
      void (async () => {
        await coAuditLoadRef.current;
        let changed = false;
        for (const [coId, drop] of coDrops) {
          const list = pendingCoAuditRef.current.get(coId);
          if (!list) continue;
          const keep = drop === 'all' ? [] : list.filter((e) => !drop.has(e.id));
          if (keep.length === list.length) continue;
          changed = true;
          if (keep.length) pendingCoAuditRef.current.set(coId, keep);
          else pendingCoAuditRef.current.delete(coId);
        }
        if (changed) await persistCoAuditPending();
      })().catch(() => {});
    }
    rereadLedgerTables(tables);
  }), [rereadLedgerTables, persistCoAuditPending]);
  // RETRY from the Not-saved sheet that took lines off it (integration round
  // 3): re-read what it wrote, as Discard does. A flush that refused a queued
  // payment append takes the payment off the device invoice; the Retry that
  // lands it raised no flush or queue event, so the invoice read unpaid until
  // the next foreground — and a second "record payment" from there found no
  // unsaved append to warn about and counted the money twice.
  // A payment append the Retry sent goes back on the device copy first
  // (idempotent by entry id): answered 'queued', the server does not have it
  // yet and the re-read alone would still show the invoice unpaid.
  useEffect(() => onUnsavedRetried((sent) => {
    const tables = new Set<string>();
    for (const f of sent) if (f.table) tables.add(f.table);
    let next = invoicesRef.current;
    let changed = false;
    const at = new Date().toISOString();
    for (const f of sent) {
      if (f.userId !== userId) continue;
      const hit = retriedAppendEntry<InvoicePayment>(f);
      const cur = hit ? next.find(i => i.id === hit.invoiceId) : undefined;
      const plan = hit && cur ? optimisticPaymentAppend(cur, hit.entry) : null;
      if (!hit || !plan) continue;
      next = mergeInvoiceUpdate(next, hit.invoiceId, plan as Partial<Invoice>, at).next;
      changed = true;
    }
    if (changed) {
      invoicesRef.current = next;
      setInvoices(next);
      saveInvoicesMutation.mutate(next);
    }
    rereadLedgerTables(tables);
  }), [userId, rereadLedgerTables, saveInvoicesMutation]);
  // A new account starts from ITS stored appends (never another account's —
  // the store is stamped with its owner), and retries them once read.
  useEffect(() => {
    const owner = userId ?? '';
    coAuditOwnerRef.current = owner;
    pendingCoAuditRef.current = new Map();
    coWriteTouchRef.current = new Map();
    proDocWriteTouchRef.current = new Map();
    planWriteTouchRef.current = new Map();
    proDocEditSeqRef.current = new Map();
    revokedSweepRef.current = new Map();
    if (!owner) { coAuditLoadRef.current = Promise.resolve(); return; }
    coAuditLoadRef.current = (async () => {
      const stored = coAuditPendingFromStore<COAuditEntry>(await loadLocal<unknown>(CO_AUDIT_PENDING_KEY, null), owner);
      if (coAuditOwnerRef.current !== owner) return;
      for (const [id, list] of stored) {
        pendingCoAuditRef.current.set(id, newAuditEntries([], [...list, ...(pendingCoAuditRef.current.get(id) ?? [])]));
      }
    })().catch(() => {});
    // Through the ref: this effect must run on an account change ONLY — a
    // re-run (canSync flipping) would clear the map it just read.
    void coAuditLoadRef.current.then(() => retryPendingCoAuditRef.current());
  }, [userId]);

  // Atomic multi-add. IMPORTANT: `addChangeOrder` closes over the render-time
  // `changeOrders` snapshot and commits the FULL array (state + AsyncStorage
  // persist), so calling it more than once in the same tick makes every call
  // build from the same stale snapshot — each one clobbers the previous CO.
  // Any code that creates several COs in one pass (e.g. the leak-CO sweep in
  // hooks/useLeakCoDrafts.ts) MUST go through this batch call instead.
  const addChangeOrders = useCallback(async (cos: ChangeOrder[]): Promise<RecordWriteOutcome> => {
    if (cos.length === 0) return 'synced';
    const finalCos: ChangeOrder[] = cos.map(co => ({
      ...co,
      portalState: co.portalState ?? initialPortalState('change_order', co.projectId),
    }));
    // The latest list (#35): a CO created and then sent in one handler must
    // be found by the send, and a batch after an edit must not drop it.
    const updated = [...finalCos, ...changeOrdersRef.current];
    changeOrdersRef.current = updated;
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);
    if (!canSync) return 'local';
    // Detailed, so the CO screen can tell "sent and saved" from "saved on this
    // phone, will sync" from "MAGE refused it" (the Send & Save alert used to
    // say "saved" in every case, including when nothing had been written).
    const outcomes = await Promise.all(finalCos.map(finalCo => {
      const insert = supabaseWriteDetailed('change_orders', 'insert', {
        ...changeOrderToRow(finalCo),
        // The only whole write of the trail: the CO's first entries (#40).
        audit_trail: finalCo.auditTrail,
        user_id: userId, created_at: finalCo.createdAt,
        portal_state: finalCo.portalState,
      });
      // Held until it reports, so an update issued meanwhile (Send & Save on a
      // CO the mic just drafted) lands AFTER the row exists — see updateChangeOrder.
      changeOrderInsertsRef.current.set(finalCo.id, insert);
      // On the wire until it reports: a change_orders re-read (realtime,
      // foreground) that started before the INSERT committed keeps this CO
      // (coIdsWrittenDuringRead) instead of dropping it from the list.
      beginCoWrite(finalCo.id);
      void insert.finally(() => {
        endCoWrite(finalCo.id);
        if (changeOrderInsertsRef.current.get(finalCo.id) === insert) changeOrderInsertsRef.current.delete(finalCo.id);
      });
      // #77/#141: a direct INSERT the server renumbered (its number was taken
      // on another device — change_orders_assign_number) must reach the list
      // and every surface (project screen, G703, AIA), not only an open CO
      // screen. A queued insert is re-pulled by the flush listener
      // (queryKeysForFlushedTables maps change_orders).
      void insert.then((o) => { if (o === 'synced') void queryClient.invalidateQueries({ queryKey: ['changeOrders', userId] }); });
      return insert;
    }));
    return worstWriteOutcome(outcomes);
  }, [saveChangeOrdersMutation, canSync, userId, initialPortalState, changeOrderToRow, beginCoWrite, endCoWrite, queryClient]);

  const addChangeOrder = useCallback((co: ChangeOrder) => addChangeOrders([co]), [addChangeOrders]);

  const updateChangeOrder = useCallback(async (id: string, updates: Partial<ChangeOrder>, reflow?: ChangeOrderReflowIntent): Promise<RecordWriteOutcome> => {
    const now = new Date().toISOString();
    // The latest list, not the render's (#35): see changeOrdersRef.
    const base = changeOrdersRef.current;
    const prior = base.find(c => c.id === id);
    const updated = base.map(co => co.id === id ? { ...co, ...updates, updatedAt: now } : co);
    changeOrdersRef.current = updated;
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);

    // Cascade: when a CO transitions to 'approved', REFLOW the linked project's
    // schedule exactly once.
    //
    // This used to be three scalar increments (totalDurationDays +=,
    // criticalPathDays +=, and bufferDays += over in project-detail.tsx). No
    // task's startDay moved, nothing was reflowed, CPM never re-ran — so the
    // owner approved "+8 days," the contract said +8 days, and every sub still
    // saw the original dates. utils/coScheduleReflowCore.ts now picks the task
    // that absorbs the days, extends it, re-runs the real CPM engine so
    // successors shift and float/critical path are recomputed, and captures a
    // baseline + audit entry first.
    //
    // Idempotency is enforced INSIDE the core (scheduleImpactApplied plus a
    // durable auditTrail marker), which is what makes this safe on every path
    // that lands here: the GC's approve button, the CO screen's status
    // pipeline, and an offline-queue replay. A double-applied CO silently adds
    // phantom weeks.
    //
    // NOT the client portal reconciler: it passes `deferReflow` and gets the
    // "place these days" marker instead. It polls from the root, so its reflow
    // rewrote project.schedule behind an open Schedule Pro, whose next drag —
    // built on a copy without it — could overwrite the days while the CO said
    // they were applied; and the CO screen promises nothing moves until he
    // applies it (audit #37).
    const nextCO = updated.find(c => c.id === id);
    const becameApproved =
      !!nextCO && nextCO.status === 'approved' && prior?.status !== 'approved';
    // A caller passing an explicit anchor is placing days on an ALREADY
    // approved CO (the "approved via portal with nothing to pin it to" case),
    // so we honour that without needing a fresh status transition.
    const shouldReflow =
      !!nextCO &&
      nextCO.status === 'approved' &&
      !isCoScheduleReflowApplied(nextCO) &&
      (becameApproved || !!reflow?.anchorTaskId);

    let committedCOs = updated;

    if (shouldReflow && nextCO && reflow?.deferReflow && !reflow.anchorTaskId) {
      if (normalizeImpactDays(nextCO.scheduleImpactDays) > 0 && !hasUnanchoredMarker(nextCO)) {
        const marker = buildDeferredCoAuditEntry(nextCO.scheduleImpactDays ?? 0, { actor: user?.email ?? user?.name ?? 'anonymous' });
        committedCOs = updated.map(co => co.id === id
          ? { ...co, auditTrail: [...(co.auditTrail ?? []), marker] }
          : co);
        changeOrdersRef.current = committedCOs;
        setChangeOrders(committedCOs);
        saveChangeOrdersMutation.mutate(committedCOs);
        // Said, not only recorded: the client signed somewhere he was not
        // looking, and the days wait for him. Tapping opens the CO, whose
        // "place these days" preview applies them (#37).
        void sendLocalNotification(
          `CO #${nextCO.number} approved in the client portal`,
          `${normalizeImpactDays(nextCO.scheduleImpactDays)} day${normalizeImpactDays(nextCO.scheduleImpactDays) === 1 ? '' : 's'} not on the schedule yet — review and place them.`,
          { changeOrderId: nextCO.id, projectId: nextCO.projectId },
        );
      }
    } else if (shouldReflow && nextCO) {
      const project = projects.find(p => p.id === nextCO.projectId);
      const actor = user?.email ?? user?.name ?? 'anonymous';
      const result = applyCoScheduleReflow(project?.schedule ?? null, nextCO, {
        anchorTaskId: reflow?.anchorTaskId,
        // Estimate items bridge CO line items → schedule tasks via
        // ScheduleTask.linkedEstimateItems (which stores materialIds).
        estimateItems: (project?.linkedEstimate?.items ?? []).map(i => ({ id: i.materialId, name: i.name })),
        actor,
      });

      if (result.plan.status === 'ready' && result.nextSchedule && result.coPatch && project) {
        // Built from the render's `projects`; stampFieldEdits against the live
        // ref keeps field progress that landed since (#25, second writer).
        const liveTasks = projectsRef.current.find(p => p.id === project.id)?.schedule?.tasks;
        const nextSchedule = { ...result.nextSchedule, tasks: stampFieldEdits(liveTasks, result.nextSchedule.tasks, now) };
        const nextProjects = projects.map(p => p.id === project.id
          ? { ...p, schedule: nextSchedule, updatedAt: now }
          : p);
        setProjects(nextProjects);
        saveProjectsMutation.mutate(nextProjects);
        const proj = nextProjects.find(p => p.id === project.id);
        if (proj) syncProjectToSupabase(proj, 'upsert');
        if (result.auditEntry) void appendAuditToAsyncStorage(project.id, result.auditEntry);

        committedCOs = updated.map(co => co.id === id ? { ...co, ...result.coPatch } : co);
        changeOrdersRef.current = committedCOs;
        setChangeOrders(committedCOs);
        saveChangeOrdersMutation.mutate(committedCOs);
        console.log('[CO reflow]', result.plan.message);
      } else if (
        (result.plan.status === 'no_anchor' || result.plan.status === 'blocked') &&
        !hasUnanchoredMarker(nextCO)
      ) {
        // Honest instead of silent: the CO is approved and the days are real,
        // but nothing on the schedule can absorb them yet (nothing links to the
        // CO, or the dependency network has a loop the engine won't guess
        // through). Record that in the CO's own history (once) so the UI can
        // surface a "place these days" prompt rather than pretending the Gantt
        // already moved.
        const marker = buildUnanchoredCoAuditEntry(result.plan, { actor });
        committedCOs = updated.map(co => co.id === id
          ? { ...co, auditTrail: [...(co.auditTrail ?? []), marker] }
          : co);
        changeOrdersRef.current = committedCOs;
        setChangeOrders(committedCOs);
        saveChangeOrdersMutation.mutate(committedCOs);
        console.log('[CO reflow] not applied —', result.plan.message);
      } else if (result.plan.status !== 'ready') {
        console.log('[CO reflow] skipped —', result.plan.status, result.plan.message);
      }
    }

    // Opportunistic leak grading: resolve leak_flag predictions for this
    // project on ANY transition to approved — money-only COs (no schedule
    // impact) are exactly the leak-recovery case, so gating this on
    // scheduleImpactDays > 0 meant leak flags never graded off their own
    // recovery. G4 fire-and-forget via gradingBus — never blocks the CO flow.
    if (becameApproved && nextCO?.projectId) fireGradingEvent(nextCO.projectId);

    // #79 · The GC's own approval (CO screen, reflow preview, project-detail
    // Approve) says who in the trail — coApprovalLine prints "Marked approved
    // by <actor>" from it, and without it the approval had no record of who
    // committed the money. Not the portal reconciler (deferReflow): it writes
    // the client's entries itself. Appended on the server with the rest of
    // this edit's new entries (auditToAppend below).
    if (becameApproved && !reflow?.deferReflow) {
      committedCOs = committedCOs.map(c => c.id === id
        ? { ...c, auditTrail: withMarkedApproved(prior?.auditTrail, c.auditTrail, { id: generateUUID(), actor: user?.email ?? user?.name ?? '', timestamp: now }) }
        : c);
      changeOrdersRef.current = committedCOs;
      setChangeOrders(committedCOs);
      saveChangeOrdersMutation.mutate(committedCOs);
    }

    if (!canSync) return 'local';
    const co = committedCOs.find(c => c.id === id);
    if (!co) return 'failed';
    // Shares changeOrderToRow with the insert so an edit can never persist
    // fewer columns than a create. portal_state is deliberately NOT here:
    // it is owned by sendToClientPortal / recallFromClientPortal, and
    // writing a possibly-stale in-memory copy on every edit is exactly how
    // warranties and aia_pay_apps nulled a good server row.
    const coPayload = { ...changeOrderToRow(co), updated_at: now };
    // #40: what this edit added to the trail — appended on the server once the
    // row is known to be there, never written over the server's trail.
    const auditToAppend = newAuditEntries(prior?.auditTrail, co.auditTrail);
    // Owed BEFORE the UPDATE goes out or is queued, and on disk: a kill
    // between here and the append must not lose them (see stashCoAudit).
    await stashCoAudit(id, auditToAppend);
    // ORDER AFTER A QUEUED CREATE. A CO made offline still has its INSERT in
    // the queue; a direct UPDATE sent now (Send & Save once signal returns,
    // before the flush) matches 0 rows and reports 'synced' — the screen said
    // "It is saved." and the queued insert then landed the old draft, which
    // the next refetch showed while the client already had the approval
    // email. Queue the update behind the insert (the flush replays FIFO) and
    // report 'queued', the same ordering invoices use. A queue that cannot be
    // read is treated as holding the insert: queuing is never wrong, a 0-row
    // "success" is.
    //
    // An insert still ON THE WIRE is the same hazard one step earlier: wait for
    // it to report first. If it queued, the check below finds it in the queue.
    // If it was refused (or could not even be queued), its payload is under
    // Not saved by the time it reports — and the write below is PARKED behind
    // it there (offlineQueue's ledger-first guard), so Retry sends the insert
    // with this edit folded in. Integration round 1: this used to return
    // 'failed' here without recording the edit anywhere, and Retry landed the
    // pre-edit draft.
    //
    // Integration round 2: this edit's owed audit entries RIDE its write (by
    // id). If the write ends under Not saved and he discards it, the discard
    // drops exactly these — the time window that did this before kept a
    // 'marked_approved' whenever the approval had waited on the CO's INSERT.
    const rides = auditToAppend.map(e => e.id);
    beginCoWrite(id);
    const outcome = await (async (): Promise<WriteOutcome> => {
      const pendingInsert = changeOrderInsertsRef.current.get(id);
      if (pendingInsert) await pendingInsert;
      let createQueued = false;
      try { createQueued = insertStillQueued(await getOfflineQueue(), 'change_orders', id); } catch { createQueued = true; }
      if (createQueued) {
        try {
          await addToOfflineQueue({ table: 'change_orders', operation: 'update', data: coPayload, ...(rides.length > 0 ? { rides } : {}) });
          return 'queued';
        } catch {
          return 'failed';
        }
      }
      return supabaseWriteDetailed('change_orders', 'update', coPayload, rides.length > 0 ? { rides } : undefined);
    })().finally(() => endCoWrite(id));
    // The row is known to be on the server only on 'synced'; otherwise the
    // owed entries (already on disk) wait for the next change_orders flush,
    // edit or launch.
    if (outcome === 'synced') void appendCoAudit(id, []);
    return outcome;
  }, [projects, saveChangeOrdersMutation, saveProjectsMutation, syncProjectToSupabase, canSync, user, changeOrderToRow, stashCoAudit, appendCoAudit, beginCoWrite, endCoWrite]);

  const getChangeOrdersForProject = useCallback((projectId: string) => {
    return changeOrders.filter(co => co.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [changeOrders]);

  const addInvoice = useCallback((invoice: Invoice) => {
    const finalInvoice: Invoice = {
      ...invoice,
      portalState: invoice.portalState ?? initialPortalState('invoice', invoice.projectId),
    };
    // invoicesRef, not the render's `invoices` — see utils/invoiceWrites for
    // the send that vanished an invoice. The ref moves now, so an
    // updateInvoice later in the same async flow composes with this add.
    const updated = [finalInvoice, ...invoicesRef.current];
    invoicesRef.current = updated;
    // Activation funnel: first invoice = first money action (drives take-rate).
    track(AnalyticsEvents.INVOICE_CREATED, {
      total_invoices: updated.length,
      type: finalInvoice.type,
      total_due: finalInvoice.totalDue,
    });
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      const isDraft = finalInvoice.status === 'draft';
      // #5 (wave 4): touched, so a list read that goes out while the INSERT
      // is on the wire keeps the device copy (the invoices loader).
      const insert = touchedWrite(proDocWriteTouchRef, finalInvoice.id, () => supabaseWriteDetailed('invoices', 'insert', {
        id: finalInvoice.id, user_id: userId, project_id: finalInvoice.projectId, number: finalInvoice.number,
        type: finalInvoice.type, progress_percent: finalInvoice.progressPercent, issue_date: finalInvoice.issueDate,
        due_date: finalInvoice.dueDate, payment_terms: finalInvoice.paymentTerms, notes: finalInvoice.notes,
        line_items: finalInvoice.lineItems, subtotal: finalInvoice.subtotal, tax_rate: finalInvoice.taxRate,
        tax_amount: finalInvoice.taxAmount, total_due: finalInvoice.totalDue, amount_paid: finalInvoice.amountPaid,
        status: finalInvoice.status, payments: finalInvoice.payments, created_at: finalInvoice.createdAt, updated_at: finalInvoice.updatedAt,
        // A draft is not QuickBooks' business until it is sent — qbo-sync
        // refuses drafts, so 'pending' only had the reconciler call it for
        // nothing (quickbooks-money #12).
        qbo_sync_status: isDraft ? null : 'pending', portal_state: finalInvoice.portalState,
        // Retention is cloud-backed as of the 20260713 migration — without
        // these it was local-only and lost on the next refetch.
        retention_percent: finalInvoice.retentionPercent ?? null,
        retention_amount: finalInvoice.retentionAmount ?? null,
        retention_released: finalInvoice.retentionReleased ?? null,
        retention_releases: finalInvoice.retentionReleases ?? null,
        // MONEY-F2: pay_link_url / pay_link_id / pay_link_amount are SERVER-owned.
        // create-payment-link writes them and stripe-webhook nulls them once the
        // (single-use) link is paid; a client write would resurrect a spent
        // link's URL and put a dead Pay button back in the client portal. The
        // read side (payLinkUrl / payLinkId) is unchanged.
        // Contract-milestone provenance. Must be written on INSERT — it is
        // what stops the same milestone being billed a second time if the
        // milestone's own status flip never reaches project_contracts.
        source_milestone_id: finalInvoice.sourceMilestoneId ?? null,
        source_contract_id: finalInvoice.sourceContractId ?? null,
        // #47: present only when the invoice names a billing contact.
        ...invoiceBillToColumns(finalInvoice, null),
      }));
      // Held until it reports, so an update issued meanwhile (the Send's flip
      // to 'sent') lands AFTER the row exists — see updateInvoice.
      invoiceInsertsRef.current.set(finalInvoice.id, insert);
      void insert.then(o => { invoiceInsertOutcomesRef.current.set(finalInvoice.id, o); }, () => { invoiceInsertOutcomesRef.current.set(finalInvoice.id, 'failed'); });
      void insert.finally(() => {
        if (invoiceInsertsRef.current.get(finalInvoice.id) === insert) invoiceInsertsRef.current.delete(finalInvoice.id);
        payInvoicesReloadIfOwed();
      });
      // Wait for the row: qbo-sync reads the invoice off the server. A queued
      // insert pushes nothing now — the reconciler sweeps 'pending' rows.
      if (!isDraft) {
        void insert.then(o => {
          if (o === 'synced') void import('@/utils/qboSync').then(m => m.triggerQboSync('invoice', 'upsert', finalInvoice.id));
        });
      }
    }
  }, [saveInvoicesMutation, canSync, userId, initialPortalState]);

  const updateInvoice = useCallback((id: string, updates: Partial<Invoice>) => {
    const now = new Date().toISOString();
    // The LATEST list (invoicesRef), never the render's closure: an invoice
    // added earlier in the same async flow must be found here, or the edit was
    // dropped and the stale list saved over the new invoice (blocker #3).
    const { next: updated, prev, merged } = mergeInvoiceUpdate(invoicesRef.current, id, updates, now);
    if (merged) {
      invoicesRef.current = updated;
      setInvoices(updated);
      saveInvoicesMutation.mutate(updated);
    }
    if (canSync) {
      // A row that is not in memory still gets its write — scoped to exactly
      // the keys this edit names — instead of being skipped: skipping is how a
      // rolled-back send stayed 'sent' on the server.
      const inv: Partial<Invoice> = merged ?? { ...updates, id };
      const payload = invoiceUpdatePayload(inv, updates, id, now);
      // #47: the billing recipient, only when this edit names it.
      Object.assign(payload, invoiceBillToColumns(inv, updates));
      // ORDER AFTER THE INSERT. A direct UPDATE that reaches PostgREST before
      // the row exists matches 0 rows and reports success, so a create
      // followed by an edit (the Send's flip to 'sent') could leave the server
      // on the created values for good. Wait for this device's insert if it is
      // still on the wire, then check the QUEUE on EVERY update — not only
      // while the insert promise is pending. The promise is forgotten the
      // moment it reports 'queued', and the queue only drains on launch /
      // foreground / its own timer, so "no signal → Send → email fails → walk
      // outside → Send again" used to flip a row that was still sitting in the
      // queue: 0 rows matched, success reported, and the drain then landed the
      // invoice as a DRAFT the client already had in their inbox (never dunned,
      // left out of A/R, never pushed to QuickBooks). If the insert is still
      // queued, queue the update behind it — the flush replays FIFO. A queue
      // that cannot be read counts as holding the insert: queuing is never
      // wrong, a 0-row "success" is. Same rule as updateChangeOrder.
      const pendingInsert = invoiceInsertsRef.current.get(id);
      const send = (): Promise<boolean> => supabaseWrite('invoices', 'update', payload);
      // Resolved false when the write only queued, so a push that depends on
      // the row never fires into an invoice the server has not seen.
      invoiceWritesInFlightRef.current += 1;
      // #5 (wave 4): touched for its whole life (the wait on the insert, the
      // queue check and the send), so a list read in that window keeps this
      // edit's device copy instead of putting the pre-edit row back.
      const invoiceWrite: Promise<boolean> = touchedWrite(proDocWriteTouchRef, id, async () => {
        try {
          if (pendingInsert) { try { await pendingInsert; } catch { /* outcome only orders the write */ } }
          let stillQueued = false;
          try { stillQueued = invoiceInsertStillQueued(await getOfflineQueue(), id); } catch { stillQueued = true; }
          if (!stillQueued) return await send();
          try { await addToOfflineQueue({ table: 'invoices', operation: 'update', data: payload }); } catch { /* reported by addToOfflineQueue */ }
          return false;
        } finally {
          invoiceWritesInFlightRef.current -= 1;
          payInvoicesReloadIfOwed();
        }
      });
      // WAIT FOR THE ROW here too. qbo-sync reads the invoice off the server;
      // fired in the same tick it could read the PRE-edit row and stamp it
      // 'synced' after this write landed, so the new due date / progress
      // percent never reached QuickBooks and the reconciler (which only
      // retries rows that are not 'synced') never looked again. A write that
      // only QUEUED pushes nothing now: the row lands with qbo_sync_status
      // 'pending', which the reconciler's sweep picks up. A draft is never
      // pushed (quickbooks-money #12).
      if (inv.status !== 'draft') {
        void invoiceWrite.then(synced => {
          if (!synced) return;
          void import('@/utils/qboSync').then(m => m.triggerQboSync('invoice', 'upsert', id));
        });
      }
      // Detect newly-added MAGE-sourced payments and fire a payment sync for each.
      if (prev && updates.payments) {
        const prevIds = new Set(prev.payments.map(p => p.id));
        const newMagePayments = updates.payments.filter((p: { id: string; source?: string; qboId?: string }) =>
          !prevIds.has(p.id) && p.source !== 'qbo' && !p.qboId
        );
        for (const np of newMagePayments) {
          const paymentId = np.id;
          // WAIT FOR THE INVOICE ROW. qbo-sync's payment path reads the payment
          // off the SERVER's invoices row; firing it in the same tick as the
          // write meant it usually arrived first and threw 'payment not found'
          // (audit round 2, #15). supabaseWrite resolves false when the write
          // was QUEUED (offline) rather than sent — then we push nothing, and
          // qbo-reconciler's sweep picks the payment up once the queued write
          // lands and the invoice has been quiet for five minutes.
          void invoiceWrite.then(synced => {
            if (!synced) return;
            void import('@/utils/qboSync').then(m => m.triggerQboSync('payment', 'upsert', `${id}::${paymentId}`));
          });
        }
      }
    }
  }, [saveInvoicesMutation, canSync]);

  // invoice-send-pay handoff: lets the invoice screen tell "not saved to the
  // server" from "still saving" after a Send. It waits on the insert while it
  // is out, then answers from the recorded outcome.
  const awaitInvoiceInsert = useCallback((id: string): Promise<WriteOutcome | undefined> => {
    const pending = invoiceInsertsRef.current.get(id);
    return pending ? pending.catch((): WriteOutcome => 'failed') : Promise.resolve(invoiceInsertOutcomesRef.current.get(id));
  }, []);

  // #80/#35 (wave 4, BLOCKER) · A recorded payment is an APPEND on the server.
  // commitPayment used to send the device's WHOLE ledger (payments +
  // amount_paid + status) through updateInvoice, and the queue replayed that
  // UPDATE verbatim on reconnect: a phone that had not seen the client's $20,000
  // Pay-link payment recorded a $300 check and erased the $20,000 on the
  // server. Now ONE entry goes to invoice_append_payment (row lock, by entry id
  // — a replay is a no-op, the ledger sum and the retention-net status are the
  // server's), as an 'rpc' op the queue orders behind any write of the same
  // invoice (CONTRACT 1) — including this device's still-queued INSERT.
  //
  // The device copy moves at once (optimisticPaymentAppend), and while the
  // call is out the loader keeps it: the append counts in
  // invoiceWritesInFlightRef (the foreground / notification re-read waits and
  // is owed) and is touched in proDocWriteTouchRef (a read already on the wire
  // keeps the device row). Then:
  //   'synced' → the guarded re-read, so the server's ledger — with any Stripe
  //              entry this phone had not seen — and status replace the guess;
  //   'queued' → the device copy stays (the loader keeps a row with a queued
  //              write) until the flush lands it and the post-flush re-pull;
  //   'failed' → refused: the entry is taken back off the device copy, because
  //              the caller tells him nothing was recorded.
  // What it gives up: for the seconds the call is out (and while queued) the
  // screen shows the device's own sum, not the server's.
  const recordInvoicePayment = useCallback(async (invoiceId: string, entry: InvoicePayment): Promise<WriteOutcome> => {
    // No account to append as: nothing reaches a ledger, so nothing is shown.
    if (!canSync) return 'failed';
    const before = invoicesRef.current.find(i => i.id === invoiceId);
    const plan = before ? optimisticPaymentAppend(before, entry) : null;
    if (before && plan) {
      const { next } = mergeInvoiceUpdate(invoicesRef.current, invoiceId, plan, new Date().toISOString());
      invoicesRef.current = next;
      setInvoices(next);
      saveInvoicesMutation.mutate(next);
    }
    invoiceWritesInFlightRef.current += 1;
    let outcome: WriteOutcome;
    try {
      // callerOwnsRefusal: on 'failed' the entry is taken back below and the
      // screen says nothing was recorded — so no Not-saved ledger line offers
      // a Retry that would append it a second time.
      outcome = await touchedWrite(proDocWriteTouchRef, invoiceId, () => supabaseRpcDetailed(
        'invoices', invoiceId, 'invoice_append_payment', { p_invoice_id: invoiceId, p_entry: entry },
        { callerOwnsRefusal: true },
      ));
    } catch {
      outcome = 'failed';
    } finally {
      invoiceWritesInFlightRef.current -= 1;
    }
    if (outcome === 'failed') {
      const cur = invoicesRef.current.find(i => i.id === invoiceId);
      const undo = cur && before && plan ? revertOptimisticPayment(cur, entry, before) : null;
      if (undo) {
        const { next } = mergeInvoiceUpdate(invoicesRef.current, invoiceId, undo, new Date().toISOString());
        invoicesRef.current = next;
        setInvoices(next);
        saveInvoicesMutation.mutate(next);
      }
      payInvoicesReloadIfOwed();
      return outcome;
    }
    if (outcome === 'synced') {
      // The server's row, not the guess. Owed instead if another invoice write
      // is still out — payInvoicesReloadIfOwed runs it when that one reports.
      await refetchInvoicesNow().catch(() => {});
      // QuickBooks reads the payment off the SERVER row, so it goes only once
      // the append has landed (a queued one is swept by qbo-reconciler: the
      // RPC stamps qbo_sync_status 'pending'). Same pushes updateInvoice fired.
      if (before?.status !== 'draft') {
        void import('@/utils/qboSync').then(m => {
          m.triggerQboSync('invoice', 'upsert', invoiceId);
          m.triggerQboSync('payment', 'upsert', `${invoiceId}::${entry.id}`);
        }).catch(() => { /* qbo-reconciler sweeps the 'pending' row */ });
      }
    }
    payInvoicesReloadIfOwed();
    return outcome;
  }, [canSync, saveInvoicesMutation, refetchInvoicesNow]);

  // Integration round 2 · A payment append that was QUEUED and then refused by
  // a flush. Only the direct 'failed' answer above took the entry back; a flush
  // drop re-read nothing (dropped writes land in no processedTables), and when
  // another write of the invoice was under Not saved too — the UPDATE queued
  // behind the append is dropped with it as an orphan — the loader kept the
  // device row, so the phone showed the refused money as recorded (status
  // paid) until Retry or Discard, and an owner device published it. Now the
  // entry comes off the device copy the moment the drop is reported, and the
  // list is re-read. Not claimed: the ledger line (Retry-able, with its
  // amount) and the flush's toast still say it. An 'enqueue failed' drop is
  // the direct call's own failure — recordInvoicePayment reverts that one.
  useEffect(() => onQueueDropped((dropped, reason) => {
    if (!userId || reason.startsWith('enqueue failed')) return;
    const hits: { invoiceId: string; entryId: string }[] = [];
    for (const m of dropped) {
      if (m.userId !== userId) continue;
      const entryId = droppedAppendEntryId(m);
      const invoiceId = m.data?.id;
      if (entryId && typeof invoiceId === 'string') hits.push({ invoiceId, entryId });
    }
    if (hits.length === 0) return;
    let next = invoicesRef.current;
    let changed = false;
    const at = new Date().toISOString();
    for (const { invoiceId, entryId } of hits) {
      const cur = next.find(i => i.id === invoiceId);
      const undo = cur ? stripDroppedPayment<InvoicePayment>(cur, entryId) : null;
      if (!undo) continue;
      next = mergeInvoiceUpdate(next, invoiceId, undo as Partial<Invoice>, at).next;
      changed = true;
    }
    if (changed) {
      invoicesRef.current = next;
      setInvoices(next);
      saveInvoicesMutation.mutate(next);
    }
    void refetchInvoicesNow().catch(() => {});
  }), [userId, saveInvoicesMutation, refetchInvoicesNow]);

  const getInvoicesForProject = useCallback((projectId: string) => invoices.filter(inv => inv.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [invoices]);
  // MONEY-F5: net of held retention — `totalDue − amountPaid` reported retention
  // the contract lets the client hold as owed on the home strip.
  const getTotalOutstandingBalance = useCallback(() => invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'draft').reduce((sum, inv) => sum + invoiceOutstanding(inv), 0), [invoices]);

  // Commitments — signed sub contracts and POs. Core data for the job
  // costing dashboard (see utils/jobCostEngine.ts). Stored locally only;
  // no Supabase sync yet because the `commitments` table hasn't been
  // migrated. Offline-first writes still work through the same pattern.
  // Map a Commitment object to the snake_case shape the commitments table
  // wants. Pulled out so add/update can both call it.
  const commitmentToRow = useCallback((c: Commitment) => ({
    id: c.id,
    user_id: userId,
    project_id: c.projectId,
    number: c.number,
    type: c.type,
    subcontractor_id: c.subcontractorId ?? null,
    vendor_name: c.vendorName ?? null,
    description: c.description ?? '',
    amount: c.amount ?? 0,
    change_amount: c.changeAmount ?? null,
    signed_date: c.signedDate || null,
    phase: c.phase ?? null,
    csi_division: c.csiDivision ?? null,
    linked_estimate_items: c.linkedEstimateItems ?? null,
    status: c.status,
    notes: c.notes ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  }), [userId]);

  const addCommitment = useCallback((c: Commitment) => {
    const updated = [c, ...commitments];
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
    // #5 (wave 4): touched — a commitments read in flight keeps this row.
    if (canSync && userId) void touchedWrite(proDocWriteTouchRef, c.id, () => supabaseWrite('commitments', 'insert', commitmentToRow(c)));
  }, [commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow]);

  const updateCommitment = useCallback((id: string, updates: Partial<Commitment>) => {
    const now = new Date().toISOString();
    const updated = commitments.map(c => c.id === id ? { ...c, ...updates, updatedAt: now } : c);
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
    const next = updated.find(c => c.id === id);
    // Behind a still-queued insert: an award made offline queues the
    // commitment's INSERT, and an edit sent directly before the drain matched
    // 0 rows — the insert then landed the award-time amount.
    if (canSync && userId && next) void touchedWrite(proDocWriteTouchRef, id, () => updateBehindQueuedInsert('commitments', commitmentToRow(next)));
  }, [commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow, updateBehindQueuedInsert]);

  const deleteCommitment = useCallback((id: string) => {
    const updated = commitments.filter(c => c.id !== id);
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('commitments', 'delete', { id }));
  }, [commitments, saveCommitmentsMutation, canSync]);

  const getCommitmentsForProject = useCallback(
    (projectId: string) => commitments.filter(c => c.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [commitments],
  );

  // Prequal packets — one per sub. We key packet lookup by sub id AND by
  // magic-link token (sub side) so the public route can resolve without
  // auth. Upsert semantics: re-submitting a packet overwrites the prior.
  const prequalToRow = useCallback((p: PrequalPacket) => ({
    id: p.id,
    user_id: userId,
    subcontractor_id: p.subcontractorId,
    project_id: p.projectId ?? null,
    status: p.status,
    criteria: p.criteria ?? {},
    financials: p.financials ?? {},
    safety: p.safety ?? {},
    insurance: p.insurance ?? {},
    licenses: p.licenses ?? [],
    w9_on_file: !!p.w9OnFile,
    w9_doc_path: p.w9DocPath ?? null,
    invite_token: p.inviteToken ?? null,
    invite_sent_at: p.inviteSentAt ?? null,
    invite_email: p.inviteEmail ?? null,
    submitted_at: p.submittedAt ?? null,
    reviewed_at: p.reviewedAt ?? null,
    reviewed_by: p.reviewedBy ?? null,
    auto_review_findings: p.autoReviewFindings ?? null,
    reviewer_notes: p.reviewerNotes ?? null,
    expires_at: p.expiresAt ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  }), [userId]);

  const upsertPrequalPacket = useCallback((packet: PrequalPacket) => {
    const isExisting = prequalPackets.some(p => p.id === packet.id);
    const updated = isExisting
      ? prequalPackets.map(p => p.id === packet.id ? packet : p)
      : [packet, ...prequalPackets];
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
    if (canSync && userId) {
      void supabaseWrite('prequal_packets', isExisting ? 'update' : 'insert', prequalToRow(packet));
    }
  }, [prequalPackets, savePrequalMutation, canSync, userId, prequalToRow]);

  // #24 (wave 5) · A review writes only the reviewer's columns and merges
  // them into the device copy (see the type). The sub's answers on the row
  // are never sent from here, so a copy loaded before he submitted cannot
  // put his old answers back.
  const reviewPrequalPacket = useCallback((id: string, patch: PrequalReviewPatch) => {
    const now = new Date().toISOString();
    const merged: PrequalReviewPatch = { ...patch, updatedAt: patch.updatedAt ?? now };
    let found = false;
    const updated = prequalPackets.map(p => {
      if (p.id !== id) return p;
      found = true;
      return { ...p, ...merged };
    });
    if (!found) return;
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
    if (canSync && userId) {
      void supabaseWrite('prequal_packets', 'update', prequalReviewRow(id, merged, now));
    }
  }, [prequalPackets, savePrequalMutation, canSync, userId]);

  const deletePrequalPacket = useCallback((id: string) => {
    const updated = prequalPackets.filter(p => p.id !== id);
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
    if (canSync) void supabaseWrite('prequal_packets', 'delete', { id });
  }, [prequalPackets, savePrequalMutation, canSync]);

  const getPrequalPacketForSub = useCallback(
    (subId: string) => prequalPackets.find(p => p.subcontractorId === subId) ?? null,
    [prequalPackets],
  );

  const getPrequalPacketByToken = useCallback(
    (token: string) => prequalPackets.find(p => p.inviteToken === token) ?? null,
    [prequalPackets],
  );

  // DFR Work Progress chips → schedule task progress propagation.
  // When the GC marks "Concrete Pour 100%" on a DFR, the linked schedule
  // task's `progress` field updates to match. This is the single biggest
  // "the app understands my work" moment: enter progress once on the DFR,
  // see it ripple to the Gantt + earned value + lookahead automatically.
  // Only ratchets UP — a later DFR that drops a task's percent doesn't
  // regress the schedule (avoids accidental rollback on a partial-day
  // report).
  const propagateProgressFromDFR = useCallback((report: DailyFieldReport) => {
    if (!report.workProgress || report.workProgress.length === 0) return;
    // projectsRef, not the render-time `projects`: the mic writes the schedule
    // and then files the report in the same tick, so the closure still holds
    // the pre-write schedule — and rebuilding from it put back any task the
    // same update had just LOWERED (the ratchet keeps the stale value).
    const proj = projectsRef.current.find(p => p.id === report.projectId);
    if (!proj?.schedule?.tasks) return;
    // Bound to a const so the narrowing survives into the async field branch
    // below (a property read does not).
    const schedule = proj.schedule;
    let touched = false;

    // AS-BUILT CAPTURE. Before this, progress moved but no actuals were ever
    // stamped here — and utils/pace/paceBook only eats tasks with status
    // 'done' AND both actualStartDay and actualEndDay. Those were set only by
    // the Gantt's manual buttons (~5% coverage per stampActuals' own header),
    // so the pace book — half the moat — starved while a superintendent filed
    // the exact evidence it needed every single day.
    //
    // The basis is the REPORT's date, not today's. A DFR filed Monday for
    // Friday's work must stamp Friday, or every back-filled report would
    // silently shift the as-built record forward and the learned durations
    // with it.
    // dayOrInstantDate, not `new Date`: an older voice report stored a bare
    // local day, which `new Date` reads as UTC midnight and stamps the
    // as-built a day early anywhere in the Americas.
    const reportDay = todayScheduleDay(proj.schedule.startDate, dayOrInstantDate(report.date));
    const reportISO = dayOrInstantDate(report.date).toISOString();

    const nextTasks = proj.schedule.tasks.map(t => {
      const chip = report.workProgress!.find(p => p.taskId === t.id);
      if (!chip) return t;
      const incoming = Math.max(0, Math.min(100, chip.pct));
      const current = t.progress ?? 0;
      if (incoming <= current) return t;
      touched = true;

      // Progress implies status: anything above 0 is under way, 100 is done.
      const nextStatus: TaskStatus = incoming >= 100 ? 'done' : 'in_progress';
      // retroStartFromPlanned:false — see StampOptions. A 0→100 jump in one
      // daily report means the work happened inside that day, not that it ran
      // from its planned start; inventing that span would teach the pace book
      // the plan it already had.
      const stamp = t.status === nextStatus
        ? {}
        : stampActuals(t, nextStatus, reportDay, reportISO, { retroStartFromPlanned: false });

      return { ...t, ...stamp, progress: incoming, status: nextStatus };
    });
    if (!touched) return;

    // WHO IS ALLOWED TO WRITE THIS (audit round 2, #25).
    //
    // The ripple is a schedule write, and updateProject sends it as a PATCH of
    // the projects row — which projects_update admits only for the owner or an
    // editor. For the superintendent on FIELD access (the person who files
    // most daily reports) PostgREST refused it with 200 + zero rows and the
    // offline queue does not count rows: his chips moved the Gantt on screen,
    // nothing reached the server, and the next reload put the old percentages
    // back with nothing said.
    //
    // Everything this function writes — progress, status and the stamped
    // actuals — is exactly what public.field_update_schedule_tasks accepts, so
    // the field path goes through that door and the local copy is only updated
    // once the server has taken it. A view-only collaborator writes nothing.
    const writePath = scheduleWritePathForRole(proj.myRole);
    if (writePath === 'none') return;
    if (writePath === 'field_rpc') {
      const { patches } = fieldTaskDiff(schedule.tasks, nextTasks);
      if (patches.length === 0) return;
      void sendFieldTaskPatches(supabase, proj.id, patches).then((sent) => {
        if (!sent.ok) {
          // Never silently: the report saved, the schedule did not, and only
          // he can decide what to do about it.
          showAlert('Schedule not updated', `${sent.message} The daily report itself saved — its progress did not reach the schedule.`);
          return;
        }
        // A task the server no longer has takes none of its patch, so neither
        // does the local copy — and he is told, rather than left with a bar
        // that only exists on this phone.
        const accepted = patches.filter((p) => !sent.missing.includes(p.id));
        if (sent.missing.length > 0) {
          showAlert('Some progress did not save', `${sent.missing.length} task${sent.missing.length === 1 ? '' : 's'} this report reported on ${sent.missing.length === 1 ? 'is' : 'are'} no longer on the schedule. The rest of the progress saved.`);
        }
        // Patch the schedule as it is NOW, not as it was before the round trip.
        const live = projectsRef.current.find(p => p.id === proj.id)?.schedule ?? schedule;
        // #87 (the fifth caller): adopt the per-key stamps the server wrote,
        // as the four screen paths do — a local copy carrying this device's
        // own guesses would lose the next 3-way merge to a peer's older edit.
        updateProject(proj.id, {
          schedule: { ...live, tasks: mergeWrittenStamps(applyFieldTaskPatches(live.tasks, accepted), sent.stamps), updatedAt: new Date().toISOString() },
        });
      });
      return;
    }
    updateProject(proj.id, {
      schedule: { ...schedule, tasks: nextTasks, updatedAt: new Date().toISOString() },
    });
  }, [updateProject]);

  // A DFR carries its own copy of the photos it was filed with, and those are
  // mirrored into the gallery under the SAME ids — so both paths resolve to the
  // same deterministic storage path and the queue's dedupe means the bytes are
  // uploaded exactly once no matter which one runs first.
  const stageDfrPhotos = useCallback((report: DailyFieldReport): DailyFieldReport => {
    if (!report.photos || report.photos.length === 0) return report;
    let changed = false;
    const photos = report.photos.map((p) => {
      if (p.storagePath || !isDeviceLocalUri(p.uri)) return p;
      const storagePath = stagePhotoUpload({
        userId, projectId: report.projectId, recordId: p.id, localUri: p.uri,
      });
      if (!storagePath) return p;
      changed = true;
      return { ...p, storagePath, localUri: p.uri };
    });
    return changed ? { ...report, photos } : report;
  }, [userId]);

  const addDailyReport = useCallback((report: DailyFieldReport) => {
    const finalReport: DailyFieldReport = {
      ...stageDfrPhotos(report),
      portalState: report.portalState ?? initialPortalState('daily_report', report.projectId),
      // #63: the author on the device copy from birth, so an offline draft
      // already says who filed it before the server read-back maps user_id.
      // Local only — the insert's user_id is the server's record, and
      // dailyReportColumns never names it (an edit cannot rewrite the author).
      filedByUserId: report.filedByUserId ?? userId ?? undefined,
    };
    // The latest list (dailyReportsRef): a report filed and then sent to the
    // portal in one handler must be found by the send.
    const updated = [finalReport, ...dailyReportsRef.current];
    dailyReportsRef.current = updated;
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    propagateProgressFromDFR(finalReport);
    if (canSync) {
      // One column list for create and edit (dailyReportColumns, #21).
      // Tracked (#23 round 2): a foreground re-read racing this INSERT keeps the report.
      void touchedWrite(proDocWriteTouchRef, finalReport.id, () => supabaseWrite('daily_reports', 'insert', {
        id: finalReport.id, user_id: userId, project_id: finalReport.projectId,
        ...dailyReportColumns(finalReport, { photos: dfrPhotoRows(finalReport.photos) }),
        created_at: finalReport.createdAt, updated_at: finalReport.updatedAt,
        portal_state: finalReport.portalState,
      }));
    }
  }, [saveDailyReportsMutation, canSync, userId, propagateProgressFromDFR, initialPortalState, stageDfrPhotos]);

  const updateDailyReport = useCallback((id: string, updates: Partial<DailyFieldReport>) => {
    const now = new Date().toISOString();
    const updated = dailyReportsRef.current.map(dr => dr.id === id ? stageDfrPhotos({ ...dr, ...updates, updatedAt: now }) : dr);
    dailyReportsRef.current = updated;
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    const dr = updated.find(d => d.id === id);
    if (dr) propagateProgressFromDFR(dr);
    if (canSync) {
      if (dr) {
        // The SAME columns the insert writes (#21): this list was typed out
        // separately and had no `date`, so a report re-dated Monday → Friday
        // moved on this phone only and the next refetch put it back on Monday.
        // portal_state stays the send / recall path's (DAILY_REPORT_INSERT_ONLY).
        void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('daily_reports', 'update', {
          id, ...dailyReportColumns(dr, { photos: dfrPhotoRows(dr.photos) }), updated_at: now,
        }));
      }
    }
  }, [saveDailyReportsMutation, canSync, propagateProgressFromDFR, stageDfrPhotos]);

  const getDailyReportsForProject = useCallback((projectId: string) => dailyReports.filter(dr => dr.projectId === projectId).sort((a, b) => dayOrInstantDate(b.date).getTime() - dayOrInstantDate(a.date).getTime()), [dailyReports]);

  // ─────────────────────────────────────────────
  // T&M / extra-work field tickets
  // ─────────────────────────────────────────────
  // Same photo-durability contract as a DFR: the row that reaches Postgres
  // carries a STORAGE PATH, never a file:// URI, and the bytes ride the
  // photo-upload queue. A ticket photo is staged under its own id so the path
  // is deterministic and the upload is idempotent.
  const stageTicketPhotos = useCallback((ticket: FieldTicket): FieldTicket => {
    if (!ticket.photos || ticket.photos.length === 0) return ticket;
    let changed = false;
    const photos = ticket.photos.map((p) => {
      if (p.storagePath || !isDeviceLocalUri(p.uri)) return p;
      const storagePath = stagePhotoUpload({
        userId, projectId: ticket.projectId, recordId: p.id, localUri: p.uri,
      });
      if (!storagePath) return p;
      changed = true;
      return { ...p, storagePath, localUri: p.uri };
    });
    return changed ? { ...ticket, photos } : ticket;
  }, [userId]);

  const ticketPhotoRows = useCallback((photos: FieldTicketPhoto[] | undefined) =>
    (photos ?? []).map(p => ({ ...p, uri: p.storagePath ?? p.uri, localUri: undefined })), []);

  const fieldTicketRow = useCallback((t: FieldTicket) => ({
    id: t.id, user_id: userId, project_id: t.projectId, number: t.number, date: t.date,
    work_description: t.workDescription, reason_extra: t.reasonExtra,
    source_daily_report_id: t.sourceDailyReportId ?? null,
    labor: t.labor, materials: t.materials, equipment: t.equipment,
    photos: ticketPhotoRows(t.photos),
    markup_percent: t.markupPercent ?? 0, status: t.status,
    authorization: t.authorization ?? null,
    converted_change_order_id: t.convertedChangeOrderId ?? null,
    converted_at: t.convertedAt ?? null,
    audit_trail: t.auditTrail ?? null,
    created_at: t.createdAt, updated_at: t.updatedAt,
  }), [userId, ticketPhotoRows]);

  const addFieldTicket = useCallback((ticket: FieldTicket) => {
    const finalTicket = stageTicketPhotos(ticket);
    const updated = [finalTicket, ...fieldTickets];
    setFieldTickets(updated);
    saveFieldTicketsMutation.mutate(updated);
    // Touched, so a list read already on the wire keeps this ticket (the loader's keep set).
    if (canSync) void touchedWrite(proDocWriteTouchRef, finalTicket.id, () => supabaseWrite('field_tickets', 'insert', fieldTicketRow(finalTicket)));
  }, [fieldTickets, saveFieldTicketsMutation, canSync, stageTicketPhotos, fieldTicketRow]);

  /**
   * A signature is evidence. Once a ticket leaves 'draft' its captured content
   * is frozen — the owner's rep signed a specific set of hours and quantities
   * and those must not move underneath the signature. The guard lives HERE, at
   * the data layer, not only in the screen: a future caller that forgets to set
   * `editable={false}` still cannot rewrite signed work.
   *
   * Returns false (and writes nothing) when the update is refused.
   */
  const updateFieldTicket = useCallback((id: string, updates: Partial<FieldTicket>): boolean => {
    const prior = fieldTickets.find(t => t.id === id);
    if (!prior) return false;
    const violations = sealedFieldTicketViolations(prior, updates);
    if (violations.length > 0) {
      // Refuse the WHOLE update — a partial apply would be worse than a no-op.
      console.warn('[FieldTicket] refused edit to a signed ticket:', id, violations.join(', '));
      return false;
    }
    const now = new Date().toISOString();
    const updated = fieldTickets.map(t => t.id === id ? stageTicketPhotos({ ...t, ...updates, updatedAt: now }) : t);
    setFieldTickets(updated);
    saveFieldTicketsMutation.mutate(updated);
    const next = updated.find(t => t.id === id);
    // #85 (wave 5): an UPDATE never carries user_id — the row's owner is the
    // server's (aa_collab_freeze_ownership pins it for anyone else anyway),
    // and a collaborator's edit must not claim the ticket.
    if (canSync && next) {
      const { user_id: _owner, ...updateRow } = fieldTicketRow(next);
      void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('field_tickets', 'update', updateRow));
    }
    return true;
  }, [fieldTickets, saveFieldTicketsMutation, canSync, stageTicketPhotos, fieldTicketRow]);

  const getFieldTicketsForProject = useCallback((projectId: string) =>
    fieldTickets.filter(t => t.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  [fieldTickets]);

  // ─────────────────────────────────────────────
  // Delay register (the claim-defense spine)
  // ─────────────────────────────────────────────

  const delayEventRow = useCallback((e: DelayEvent) => ({
    id: e.id, user_id: userId, project_id: e.projectId, number: e.number,
    cause: e.cause,
    first_observed_date: e.firstObservedDate,
    ended_date: e.endedDate ?? null,
    description: e.description,
    evidence: e.evidence ?? [],
    impacted_task_ids: e.impactedTaskIds ?? [],
    claimed_days: e.claimedDays ?? 0,
    concurrent_days: e.concurrentDays ?? null,
    notices: e.notices ?? [],
    classification: e.classification ?? 'unclassified',
    change_order_id: e.changeOrderId ?? null,
    audit_trail: e.auditTrail ?? null,
    created_at: e.createdAt, updated_at: e.updatedAt,
  }), [userId]);

  /**
   * Returns the created event so callers (the daily report, the weather
   * reschedule) can route straight to it without racing on closure refresh —
   * same pattern as addRFI / addLead.
   */
  // ── Deliveries ────────────────────────────────────────────────────────────
  // What is DUE on site. delivery_receipts records what arrived; this records
  // what was promised, which is the half that lets the app chase a late load
  // before the crew is standing around.
  const deliveryRow = useCallback((d: Delivery) => ({
    id: d.id,
    user_id: userId,
    project_id: d.projectId,
    description: d.description,
    supplier: d.supplier,
    commitment_id: d.commitmentId ?? null,
    po_number: d.poNumber ?? null,
    expected_date: d.expectedDate,
    // Column is delivery_window, NOT window: `window` is a reserved Postgres
    // keyword, so the table could not have been created with it. The TS field
    // keeps the short name — this mapper is the only place they differ.
    delivery_window: d.window ?? null,
    status: d.status,
    confirmed_at: d.confirmedAt ?? null,
    delivered_at: d.deliveredAt ?? null,
    receipt_id: d.receiptId ?? null,
    location: d.location ?? null,
    received_by: d.receivedBy ?? null,
    notes: d.notes ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }), [userId]);

  const saveDeliveriesMutation = useMutation({
    mutationFn: async (updated: Delivery[]) => { await saveLocal(DELIVERIES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['deliveries', userId], data); },
  });

  const addDelivery = useCallback((d: Delivery): Delivery => {
    const updated = [d, ...deliveries];
    setDeliveries(updated);
    saveDeliveriesMutation.mutate(updated);
    if (canSync) void supabaseWrite('deliveries', 'insert', deliveryRow(d));
    return d;
  }, [deliveries, saveDeliveriesMutation, canSync, deliveryRow]);

  const updateDelivery = useCallback((id: string, updates: Partial<Delivery>) => {
    const now = new Date().toISOString();
    const updated = deliveries.map(d => d.id === id ? { ...d, ...updates, updatedAt: now } : d);
    setDeliveries(updated);
    saveDeliveriesMutation.mutate(updated);
    const next = updated.find(d => d.id === id);
    if (canSync && next) void supabaseWrite('deliveries', 'update', deliveryRow(next));
  }, [deliveries, saveDeliveriesMutation, canSync, deliveryRow]);

  const deleteDelivery = useCallback((id: string) => {
    const updated = deliveries.filter(d => d.id !== id);
    setDeliveries(updated);
    saveDeliveriesMutation.mutate(updated);
    if (canSync) void supabaseWrite('deliveries', 'delete', { id });
  }, [deliveries, saveDeliveriesMutation, canSync]);

  // ── Building access ───────────────────────────────────────────────────────
  // What the building requires, and the slots booked against it. Joined against
  // deliveries by utils/buildingAccess to surface loads with nowhere to land.
  const saveBuildingAccessMutation = useMutation({
    mutationFn: async (updated: BuildingAccessRules[]) => { await saveLocal(BUILDING_ACCESS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['buildingAccess', userId], data); },
  });

  /** Upsert by projectId — a project has exactly one set of building rules, so
   *  there is no add/update split to get wrong. */
  const setBuildingAccess = useCallback((rules: BuildingAccessRules) => {
    const now = new Date().toISOString();
    const next = { ...rules, updatedAt: now };
    const exists = buildingAccessRules.some(r => r.projectId === rules.projectId);
    const updated = exists
      ? buildingAccessRules.map(r => r.projectId === rules.projectId ? next : r)
      : [next, ...buildingAccessRules];
    setBuildingAccessRules(updated);
    saveBuildingAccessMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('building_access_rules', 'upsert', {
        project_id: next.projectId,
        user_id: userId,
        building_contact: next.buildingContact ?? null,
        building_phone: next.buildingPhone ?? null,
        requires_freight_elevator: next.requiresFreightElevator,
        requires_dock_reservation: next.requiresDockReservation,
        requires_coi_on_file: next.requiresCoiOnFile,
        coi_on_file_at: next.coiOnFileAt ?? null,
        requires_badging: next.requiresBadging,
        badge_lead_time_days: next.badgeLeadTimeDays ?? null,
        work_hours: next.workHours ?? null,
        after_hours_requires_approval: next.afterHoursRequiresApproval,
        notes: next.notes ?? null,
        updated_at: now,
      });
    }
  }, [buildingAccessRules, saveBuildingAccessMutation, canSync, userId]);

  const getBuildingAccess = useCallback(
    (projectId: string) => buildingAccessRules.find(r => r.projectId === projectId) ?? null,
    [buildingAccessRules],
  );

  const saveReservationsMutation = useMutation({
    mutationFn: async (updated: AccessReservation[]) => { await saveLocal(ACCESS_RESERVATIONS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['accessReservations', userId], data); },
  });

  const reservationRow = useCallback((r: AccessReservation) => ({
    id: r.id,
    user_id: userId,
    project_id: r.projectId,
    kind: r.kind,
    date: r.date,
    // Column is reservation_window — `window` is reserved in Postgres.
    reservation_window: r.window ?? null,
    status: r.status,
    confirmation_ref: r.confirmationRef ?? null,
    delivery_id: r.deliveryId ?? null,
    requested_at: r.requestedAt ?? null,
    confirmed_at: r.confirmedAt ?? null,
    notes: r.notes ?? null,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }), [userId]);

  const addReservation = useCallback((r: AccessReservation): AccessReservation => {
    const updated = [r, ...accessReservations];
    setAccessReservations(updated);
    saveReservationsMutation.mutate(updated);
    if (canSync) void supabaseWrite('access_reservations', 'insert', reservationRow(r));
    return r;
  }, [accessReservations, saveReservationsMutation, canSync, reservationRow]);

  const updateReservation = useCallback((id: string, updates: Partial<AccessReservation>) => {
    const now = new Date().toISOString();
    const updated = accessReservations.map(r => r.id === id ? { ...r, ...updates, updatedAt: now } : r);
    setAccessReservations(updated);
    saveReservationsMutation.mutate(updated);
    const next = updated.find(r => r.id === id);
    if (canSync && next) void supabaseWrite('access_reservations', 'update', reservationRow(next));
  }, [accessReservations, saveReservationsMutation, canSync, reservationRow]);

  const saveDeliveryReceiptsMutation = useMutation({
    mutationFn: async (updated: DeliveryReceipt[]) => { await saveLocal(DELIVERY_RECEIPTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['deliveryReceipts', userId], data); },
  });

  /** Record what actually arrived, and link it to the promise it closes out.
   *  Sets deliveries.receipt_id — the column added with the deliveries table and
   *  never populated until now — so the schedule and the receiving log are one
   *  story rather than two. */
  const addDeliveryReceipt = useCallback((r: DeliveryReceipt): DeliveryReceipt => {
    const updated = [r, ...deliveryReceipts];
    setDeliveryReceipts(updated);
    saveDeliveryReceiptsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('delivery_receipts', 'insert', {
        id: r.id, user_id: userId, project_id: r.projectId,
        delivery_id: r.deliveryId ?? null,
        date: r.date, supplier: r.supplier,
        po_number: r.poNumber ?? null,
        commitment_id: r.commitmentId ?? null,
        // NOT NULL jsonb — an empty array is a valid receipt (the load landed;
        // nobody itemized it), but null would be rejected outright.
        items: r.items ?? [],
        bol_photo_uri: r.bolPhotoUri ?? null,
        signature_photo_uri: r.signaturePhotoUri ?? null,
        has_damage: r.hasDamage,
        damage_notes: r.damageNotes ?? null,
        received_at: r.receivedAt,
        received_by: r.receivedBy,
        notes: r.notes ?? null,
        created_at: r.createdAt, updated_at: r.updatedAt,
      });
    }
    return r;
  }, [deliveryReceipts, saveDeliveryReceiptsMutation, canSync, userId]);

  const getReceiptsForProject = useCallback(
    (projectId: string) => deliveryReceipts.filter(r => r.projectId === projectId),
    [deliveryReceipts],
  );

  const deleteReservation = useCallback((id: string) => {
    const updated = accessReservations.filter(r => r.id !== id);
    setAccessReservations(updated);
    saveReservationsMutation.mutate(updated);
    if (canSync) void supabaseWrite('access_reservations', 'delete', { id });
  }, [accessReservations, saveReservationsMutation, canSync]);

  const addDelayEvent = useCallback((event: DelayEvent): DelayEvent => {
    const updated = [event, ...delayEvents];
    setDelayEvents(updated);
    saveDelayEventsMutation.mutate(updated);
    if (canSync) void supabaseWrite('delay_events', 'insert', delayEventRow(event));
    return event;
  }, [delayEvents, saveDelayEventsMutation, canSync, delayEventRow]);

  const updateDelayEvent = useCallback((id: string, updates: Partial<DelayEvent>) => {
    const now = new Date().toISOString();
    const updated = delayEvents.map(e => e.id === id ? { ...e, ...updates, updatedAt: now } : e);
    setDelayEvents(updated);
    saveDelayEventsMutation.mutate(updated);
    const next = updated.find(e => e.id === id);
    if (canSync && next) void supabaseWrite('delay_events', 'update', delayEventRow(next));
  }, [delayEvents, saveDelayEventsMutation, canSync, delayEventRow]);

  const deleteDelayEvent = useCallback((id: string) => {
    const updated = delayEvents.filter(e => e.id !== id);
    setDelayEvents(updated);
    saveDelayEventsMutation.mutate(updated);
    if (canSync) void supabaseWrite('delay_events', 'delete', { id });
  }, [delayEvents, saveDelayEventsMutation, canSync]);

  /** Chronological — the order a claim narrative is told in. */
  const getDelayEventsForProject = useCallback((projectId: string) =>
    delayEvents.filter(e => e.projectId === projectId)
      .sort((a, b) => a.firstObservedDate.localeCompare(b.firstObservedDate)),
  [delayEvents]);

  // ─────────────────────────────────────────────
  // CRM / Leads
  // ─────────────────────────────────────────────
  // Returns the new Lead so callers (e.g. UniversalMicButton) can route
  // straight to /lead-detail without racing on closure refresh — same
  // pattern used by addRFI.
  const addLead = useCallback((lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'receivedAt'> & { id?: string; receivedAt?: string }): Lead => {
    const now = new Date().toISOString();
    const newLead: Lead = {
      ...lead,
      id: lead.id ?? generateUUID(),
      receivedAt: lead.receivedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newLead, ...leads];
    setLeads(updated);
    saveLeadsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('leads', 'insert', {
        id: newLead.id, user_id: userId,
        name: newLead.name, phone: newLead.phone, email: newLead.email, address: newLead.address,
        project_type: newLead.projectType, project_type_mapped: newLead.projectTypeMapped,
        scope: newLead.scope, budget_min: newLead.budgetMin, budget_max: newLead.budgetMax,
        timeline: newLead.timeline, source: newLead.source, source_other: newLead.sourceOther,
        stage: newLead.stage, score: newLead.score, score_reason: newLead.scoreReason,
        received_at: newLead.receivedAt, first_responded_at: newLead.firstRespondedAt,
        touches: newLead.touches ?? [], converted_project_id: newLead.convertedProjectId,
        lost_reason: newLead.lostReason, created_at: now, updated_at: now,
      });
    }
    return newLead;
  }, [leads, saveLeadsMutation, canSync, userId]);

  const updateLead = useCallback((id: string, updates: Partial<Lead>) => {
    const now = new Date().toISOString();
    const updated = leads.map(l => l.id === id ? { ...l, ...updates, updatedAt: now } : l);
    setLeads(updated);
    saveLeadsMutation.mutate(updated);
    if (canSync) {
      const l = updated.find(x => x.id === id);
      if (l) {
        void supabaseWrite('leads', 'update', {
          id, name: l.name, phone: l.phone, email: l.email, address: l.address,
          project_type: l.projectType, project_type_mapped: l.projectTypeMapped,
          scope: l.scope, budget_min: l.budgetMin, budget_max: l.budgetMax,
          timeline: l.timeline, source: l.source, source_other: l.sourceOther,
          stage: l.stage, score: l.score, score_reason: l.scoreReason,
          received_at: l.receivedAt, first_responded_at: l.firstRespondedAt,
          touches: l.touches ?? [], converted_project_id: l.convertedProjectId,
          lost_reason: l.lostReason, updated_at: now,
        });
      }
    }
  }, [leads, saveLeadsMutation, canSync]);

  const deleteLead = useCallback((id: string) => {
    const updated = leads.filter(l => l.id !== id);
    setLeads(updated);
    saveLeadsMutation.mutate(updated);
    if (canSync) void supabaseWrite('leads', 'delete', { id });
  }, [leads, saveLeadsMutation, canSync]);

  const getLead = useCallback((id: string) => leads.find(l => l.id === id) ?? null, [leads]);
  const refreshLeads = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['leads', userId] });
  }, [queryClient, userId]);

  const getLeadsByStage = useCallback((stage: LeadStage) => leads.filter(l => l.stage === stage), [leads]);

  /** Append a touch (call/text/email/etc) to a lead's activity log. If
   *  this is the first touch and firstRespondedAt isn't set, stamp it
   *  now — drives the "responded in Xh" KPI on the pipeline screen. */
  const addLeadTouch = useCallback((leadId: string, kind: LeadTouch['kind'], body: string, byName?: string) => {
    const now = new Date().toISOString();
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const touch: LeadTouch = {
      id: generateUUID(),
      kind, body, occurredAt: now, byName,
    };
    const nextTouches = [touch, ...(lead.touches ?? [])];
    const firstRespondedAt = lead.firstRespondedAt
      ?? (kind !== 'note' ? now : undefined);
    updateLead(leadId, { touches: nextTouches, firstRespondedAt });
  }, [leads, updateLead]);

  /** Convert a 'won' lead into a real Project. Idempotent — if already
   *  converted, returns the existing project id. */
  const convertLeadToProject = useCallback((leadId: string): string | null => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return null;
    if (lead.convertedProjectId) return lead.convertedProjectId;
    const now = new Date().toISOString();
    const projectId = generateUUID();
    // Use the inline addProject path so we don't introduce a new
    // dependency between callbacks here.
    // Carry the homeowner contact + lead-source + timeline-notes across
    // so the GC doesn't re-key phone/email after winning the lead, and so
    // win-rate-by-source analytics keep working post-conversion.
    const primaryContact = (lead.phone || lead.email || lead.name)
      ? {
          name: lead.name || undefined,
          phone: lead.phone || undefined,
          email: lead.email || undefined,
        }
      : undefined;
    const newProject: Project = {
      id: projectId,
      // A-1: created by this account — see claimProjectForUser / addProject.
      ownerUserId: userId ?? undefined,
      name: lead.name + (lead.projectType ? ` — ${lead.projectType}` : ''),
      // A widget lead now arrives with project_type_mapped; older ones map
      // back from the widget's scope label (utils/widgetLeadCore).
      type: (projectTypeForLead(lead) ?? 'renovation') as ProjectType,
      location: lead.address ?? 'United States',
      squareFootage: 0,
      quality: 'standard',
      description: lead.scope ?? '',
      status: 'estimated',
      estimate: null,
      schedule: null,
      // His own latest quote first, then a budget the homeowner stated —
      // NEVER the website widget's national ballpark (audit round 2, #24).
      // That range used to land here as 'Target budget set by you', and the
      // portal and WIP read targetBudget as the contract value until an
      // estimate exists.
      targetBudget: targetBudgetSeedForLead(lead, now),
      primaryContact,
      leadSource: lead.source || undefined,
      targetTimelineNotes: lead.timeline || undefined,
      createdAt: now,
      updatedAt: now,
    };
    // Written straight to Supabase below, not through syncProjectToSupabase —
    // so it records its own write for the load guard.
    noteProjectWrite(projectWriteLogRef.current, newProject.id);
    setProjects(prev => [newProject, ...prev]);
    saveProjectsMutation.mutate([newProject, ...projects]);
    if (canSync) {
      // SYNC-F14: the project_financials INSERT policy needs the project row to
      // exist, so the two writes must not race — await the project first
      // (mirrors syncProjectToSupabase). The pair is fire-and-forget as a whole
      // so the conversion itself stays synchronous.
      const targetBudget = newProject.targetBudget;
      void (async () => {
        const landed = await supabaseWrite('projects', 'insert', {
          id: projectId, user_id: userId, name: newProject.name, type: newProject.type,
          location: newProject.location, square_footage: 0, quality: 'standard',
          description: newProject.description, status: newProject.status,
          target_budget: targetBudget,
          primary_contact: newProject.primaryContact ?? null,
          lead_source: newProject.leadSource ?? null,
          target_timeline_notes: newProject.targetTimelineNotes ?? null,
          created_at: now, updated_at: now,
        });
        // Dual-write the budget to project_financials — see the sync path above.
        // Gated on the project write: a REFUSED insert (RLS) must not be followed
        // by a second refusal and a second toast; a write that merely QUEUED
        // (offline) still proceeds — the queue lands projects first.
        if (targetBudget && (landed || (await queuedIdsFor('projects')).has(projectId))) {
          await supabaseWrite('project_financials', 'upsert', {
            project_id: projectId, user_id: userId,
            target_budget: targetBudget,
            created_at: now, updated_at: now,
          });
        }
      })();
    }
    updateLead(leadId, { stage: 'won', convertedProjectId: projectId });
    return projectId;
  }, [leads, projects, saveProjectsMutation, canSync, userId, updateLead]);

  // ─────────────────────────────────────────────
  // Buyout — Bid Packages + Bids
  // ─────────────────────────────────────────────
  const addBidPackage = useCallback((pkg: Omit<BidPackage, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): BidPackage => {
    const now = new Date().toISOString();
    const newPkg: BidPackage = {
      ...pkg,
      id: pkg.id ?? generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newPkg, ...bidPackages];
    setBidPackages(updated);
    saveBidPackagesMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('bid_packages', 'insert', {
        id: newPkg.id, user_id: userId, project_id: newPkg.projectId,
        name: newPkg.name, csi_division: newPkg.csiDivision, phase: newPkg.phase,
        scope_description: newPkg.scopeDescription,
        linked_estimate_item_ids: newPkg.linkedEstimateItemIds,
        estimate_budget: newPkg.estimateBudget, status: newPkg.status,
        due_date: newPkg.dueDate, required_by_date: newPkg.requiredByDate,
        awarded_bid_id: newPkg.awardedBidId, awarded_commitment_id: newPkg.awardedCommitmentId,
        buyout_savings: newPkg.buyoutSavings, notes: newPkg.notes,
        created_at: now, updated_at: now,
      });
    }
    return newPkg;
  }, [bidPackages, saveBidPackagesMutation, canSync, userId]);

  const updateBidPackage = useCallback((id: string, updates: Partial<BidPackage>) => {
    const now = new Date().toISOString();
    const updated = bidPackages.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p);
    setBidPackages(updated);
    saveBidPackagesMutation.mutate(updated);
    if (canSync) {
      const p = updated.find(x => x.id === id);
      if (p) {
        void supabaseWrite('bid_packages', 'update', {
          id, name: p.name, csi_division: p.csiDivision, phase: p.phase,
          scope_description: p.scopeDescription,
          linked_estimate_item_ids: p.linkedEstimateItemIds,
          estimate_budget: p.estimateBudget, status: p.status,
          due_date: p.dueDate, required_by_date: p.requiredByDate,
          awarded_bid_id: p.awardedBidId, awarded_commitment_id: p.awardedCommitmentId,
          buyout_savings: p.buyoutSavings, notes: p.notes, updated_at: now,
        });
      }
    }
  }, [bidPackages, saveBidPackagesMutation, canSync]);

  const deleteBidPackage = useCallback((id: string) => {
    const updated = bidPackages.filter(p => p.id !== id);
    setBidPackages(updated);
    saveBidPackagesMutation.mutate(updated);
    // Cascade: also drop the bids for this package locally.
    const remainingBids = bidPackageBids.filter(b => b.packageId !== id);
    setBidPackageBids(remainingBids);
    saveBidPackageBidsMutation.mutate(remainingBids);
    if (canSync) void supabaseWrite('bid_packages', 'delete', { id });
  }, [bidPackages, bidPackageBids, saveBidPackagesMutation, saveBidPackageBidsMutation, canSync]);

  const getBidPackagesForProject = useCallback((projectId: string) =>
    bidPackages.filter(p => p.projectId === projectId), [bidPackages]);

  const getBidPackage = useCallback((id: string) =>
    bidPackages.find(p => p.id === id) ?? null, [bidPackages]);

  // Bids
  const addBidPackageBid = useCallback((bid: Omit<BidPackageBid, 'id' | 'createdAt' | 'updatedAt' | 'submittedAt'> & { id?: string; submittedAt?: string }): BidPackageBid => {
    const now = new Date().toISOString();
    const newBid: BidPackageBid = {
      ...bid,
      id: bid.id ?? generateUUID(),
      submittedAt: bid.submittedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newBid, ...bidPackageBids];
    setBidPackageBids(updated);
    saveBidPackageBidsMutation.mutate(updated);
    // If the package was 'open', auto-promote it to 'leveling' on first bid.
    const pkg = bidPackages.find(p => p.id === bid.packageId);
    if (pkg && pkg.status === 'open') {
      updateBidPackage(pkg.id, { status: 'leveling' });
    }
    if (canSync) {
      void supabaseWrite('bid_package_bids', 'insert', {
        id: newBid.id, user_id: userId, package_id: newBid.packageId,
        subcontractor_id: newBid.subcontractorId, vendor_name: newBid.vendorName,
        amount: newBid.amount, includes: newBid.includes, excludes: newBid.excludes,
        terms: newBid.terms, source: newBid.source, status: newBid.status,
        submitted_at: newBid.submittedAt,
        normalized_adjustment: newBid.normalizedAdjustment,
        normalized_adjustment_reason: newBid.normalizedAdjustmentReason,
        notes: newBid.notes, created_at: now, updated_at: now,
      });
    }
    return newBid;
  }, [bidPackages, bidPackageBids, saveBidPackageBidsMutation, updateBidPackage, canSync, userId]);

  const updateBidPackageBid = useCallback((id: string, updates: Partial<BidPackageBid>) => {
    const now = new Date().toISOString();
    const updated = bidPackageBids.map(b => b.id === id ? { ...b, ...updates, updatedAt: now } : b);
    setBidPackageBids(updated);
    saveBidPackageBidsMutation.mutate(updated);
    if (canSync) {
      const b = updated.find(x => x.id === id);
      if (b) {
        void supabaseWrite('bid_package_bids', 'update', {
          id, subcontractor_id: b.subcontractorId, vendor_name: b.vendorName,
          amount: b.amount, includes: b.includes, excludes: b.excludes,
          terms: b.terms, source: b.source, status: b.status,
          normalized_adjustment: b.normalizedAdjustment,
          normalized_adjustment_reason: b.normalizedAdjustmentReason,
          notes: b.notes, updated_at: now,
        });
      }
    }
  }, [bidPackageBids, saveBidPackageBidsMutation, canSync]);

  const deleteBidPackageBid = useCallback((id: string) => {
    const updated = bidPackageBids.filter(b => b.id !== id);
    setBidPackageBids(updated);
    saveBidPackageBidsMutation.mutate(updated);
    if (canSync) void supabaseWrite('bid_package_bids', 'delete', { id });
  }, [bidPackageBids, saveBidPackageBidsMutation, canSync]);

  const getBidsForPackage = useCallback((packageId: string) =>
    bidPackageBids.filter(b => b.packageId === packageId), [bidPackageBids]);

  /** Award a bid: creates a Commitment, marks the package awarded,
   *  computes buyout savings, and locks any allowance items linked to
   *  this package to firm price. Idempotent — if already awarded,
   *  returns the existing commitment id.
   *
   *  Implementation note: this orchestrates 4 state updates (commitments,
   *  bidPackages, bidPackageBids, projects) and we want them to land
   *  atomically without stale-closure reads. We compute every "next"
   *  array up front from the closure-captured arrays once, then batch
   *  the setState + persist + Supabase-sync calls. No use of the
   *  per-row update* helpers here, because each one would re-read
   *  this callback's closure version of state and re-execute the
   *  Supabase write paths separately. */
  const awardBidPackage = useCallback((packageId: string, bidId: string, opts?: { overrideNote?: string }): string | null => {
    const pkg = bidPackages.find(p => p.id === packageId);
    const bid = bidPackageBids.find(b => b.id === bidId);
    if (!pkg || !bid) return null;
    if (pkg.awardedCommitmentId) return pkg.awardedCommitmentId;
    // Defensive: refuse a bid that doesn't belong to this package.
    // Code-review #3.
    if (bid.packageId !== packageId) {
      console.warn('[awardBidPackage] bid.packageId mismatch — refusing', { packageId, bidPackageId: bid.packageId });
      return null;
    }
    // Defensive: refuse a $0 bid (voice transcripts where the parser
    // failed to extract a number return amount: 0 — awarding would
    // create a phantom commitment with the full estimate as "savings").
    // Code-review #4.
    if (!bid.amount || bid.amount <= 0) {
      console.warn('[awardBidPackage] zero / negative bid amount — refusing');
      return null;
    }
    const now = new Date().toISOString();
    // Committed cost = the ACTUAL awarded bid price. This is what the sub is
    // owed and what the signed subcontract locks in (the A401 contractSum in
    // buyout-package.tsx uses bid.amount), so the commitment must match it.
    // Buyout savings = budget - committed price.
    //
    // normalizedAdjustment (the AI "leveled total" that estimates the cost of
    // scope this bid EXCLUDES) is deliberately NOT folded into the sub's
    // committed cost — that overstated what we owe this sub and contradicted
    // the subcontract.
    //
    // SAVINGS ARE LEVELED; THE COMMITMENT IS NOT (audit round 2, #5). Scope the
    // sub excludes is not money saved — he still has to buy it — so the stored
    // savings subtract the SIGNED adjustment, the same figure the Award dialog,
    // the package hero and buyout.tsx show (utils/projectFinancials
    // leveledBuyoutSavings). Storing budget − bid claimed the excluded scope as
    // savings on every surface that reads pkg.buyoutSavings.
    const committedAmount = bid.amount;
    const savings = leveledBuyoutSavings(pkg.estimateBudget, bid);
    // Estimated cost of scope the awarded bid excludes (AI-leveled, 0 when
    // none). Named in the commitment's notes only — see NO PLACEHOLDER PO below.
    const uncoveredScope = uncoveredScopeOf(bid);
    // commitments.signed_date is a `date` column: an ISO instant from an
    // evening award in a US zone stores as the NEXT UTC day and the device
    // shows that day after the next refetch. Stamp his calendar day.
    const signedDay = todayCalendarDay();
    // Sequential commitment number per project (mirrors addChangeOrder's
    // pattern — code-review #11). Avoids the slim collision risk of the
    // 6-char UUID prefix and reads better on documents the GC sends out.
    const projectCommitments = commitments.filter(c => c.projectId === pkg.projectId);
    // max(existing BO-N) + 1, not length + 1 — deleting a commitment must not
    // reissue an already-used BO number on documents the GC sends out.
    const maxBo = projectCommitments.reduce((max, c) => {
      const n = parseInt(String(c.number ?? '').replace(/^BO-/, ''), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const nextNumber = `BO-${maxBo + 1}`;
    const commitmentId = generateUUID();
    const commitment: Commitment = {
      id: commitmentId,
      projectId: pkg.projectId,
      number: nextNumber,
      type: 'subcontract',
      subcontractorId: bid.subcontractorId,
      vendorName: bid.vendorName,
      description: pkg.name + (bid.includes ? ` — ${bid.includes}` : ''),
      amount: committedAmount,
      signedDate: signedDay,
      phase: pkg.phase,
      csiDivision: pkg.csiDivision,
      linkedEstimateItems: pkg.linkedEstimateItemIds,
      status: 'active',
      // Force en-US locale so the saved notes are consistent regardless
      // of device locale (code-review #7).
      notes: `Awarded from buyout package "${pkg.name}". Buyout ${savings >= 0 ? 'savings' : 'overrun'} (leveled): $${Math.abs(savings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.${uncoveredScope > 0 ? ` Scope this bid excludes (est. at award, not in this commitment): $${uncoveredScope.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` : ''}${opts?.overrideNote ? `\n${opts.overrideNote}` : ''}`,
      createdAt: now,
      updatedAt: now,
    };
    // NO PLACEHOLDER PO FOR THE EXCLUDED SCOPE (integration review, money).
    // A round-2 fix booked it as an 'active' purchase_order named "Uncovered:
    // …". Every commitment reader counts active POs as a real vendor, so the
    // homeowner's Home Passport listed "Uncovered: blocking and dumpster" as a
    // supplier, Handover's lien-waiver row could never reach done, the open-
    // book/GMP portal showed it as committed, and nothing in the app can
    // close a commitment — once he bought the scope for real it was counted
    // twice in Job Costing, margin alerts, cash flow and realized margin.
    // The gap is derivable from the awarded bid (uncoveredScopeOf), so it is
    // shown where it is true — as uncommitted, estimated scope on the buyout
    // hero and in Job Costing — and never as a commitment. Job Costing's
    // projection keeps that scope's budget in its uncommitted floor. The cost
    // book is NOT made whole by the later PO: nothing links that PO to this
    // package's estimate line, so a single-line package still teaches the
    // bid-only rate. Linking bought scope to its package line is a deferred
    // product/schema decision — do not assume the PO closes the gap.

    // ── Pre-compute every next array atomically (code-review #2 + #6) ──
    // Each state slice is updated using its closure-captured value
    // exactly once, so two awards in quick succession can't lose data
    // through stale-closure reads.
    const nextCommitments = [commitment, ...commitments];
    const nextPackages = bidPackages.map(p =>
      p.id === packageId
        ? { ...p, status: 'awarded' as BidPackageStatus, awardedBidId: bidId, awardedCommitmentId: commitmentId, buyoutSavings: savings, updatedAt: now }
        : p,
    );
    const nextBids = bidPackageBids.map(b =>
      b.id === bidId
        ? { ...b, status: 'awarded' as BuyoutBidStatus, updatedAt: now }
        : b,
    );

    // Allowance → firm-price conversion. Any estimate items linked to
    // this package that were flagged isAllowance get locked: cleared
    // isAllowance, stamped firmPricedAt. The portal + budget pick up
    // the new firm number on the next render.
    let nextProjects = projects;
    let updatedProject: Project | null = null;
    let allowanceLockdownKeys: string[] = [];
    if (pkg.linkedEstimateItemIds.length > 0) {
      const proj = projects.find(p => p.id === pkg.projectId);
      const linkedEstimate = proj?.linkedEstimate;
      if (proj && linkedEstimate && linkedEstimate.items.some(i => pkg.linkedEstimateItemIds.includes(i.materialId) && i.isAllowance)) {
        // H7: snapshot the CURRENT estimate (pre-buyout) before we mutate
        // it to firm prices. snapshotPatch appends to proj.estimateVersions
        // (the fresh array just read from closure state) so the result
        // is always monotonically growing — stale-closure clobber
        // is impossible because we read from `proj` here, not from a
        // separately-captured array that could be behind.
        const preBuyoutPatch = snapshotPatch(proj, 'pre_overwrite', 'pre-buyout snapshot');
        const updatedItems = linkedEstimate.items.map(item => {
          if (pkg.linkedEstimateItemIds.includes(item.materialId) && item.isAllowance) {
            return { ...item, isAllowance: false, firmPricedAt: now };
          }
          return item;
        });
        // Spread preBuyoutPatch (which may contain estimateVersions with the
        // appended revision) into updatedProject so the single Supabase upsert
        // carries BOTH the firm-priced estimate AND the updated version history.
        updatedProject = { ...proj, ...preBuyoutPatch, linkedEstimate: { ...linkedEstimate, items: updatedItems }, updatedAt: now };
        allowanceLockdownKeys = [...Object.keys(preBuyoutPatch), 'linkedEstimate', 'updatedAt'];
        nextProjects = projects.map(p => p.id === pkg.projectId ? updatedProject! : p);
      }
    }

    // ── Apply all state updates ──
    setCommitments(nextCommitments);
    saveCommitmentsMutation.mutate(nextCommitments);

    setBidPackages(nextPackages);
    saveBidPackagesMutation.mutate(nextPackages);

    setBidPackageBids(nextBids);
    saveBidPackageBidsMutation.mutate(nextBids);

    if (updatedProject) {
      setProjects(nextProjects);
      saveProjectsMutation.mutate(nextProjects);
      // Critical fix (code-review #1): sync the firm-priced project
      // back to Supabase so the homeowner portal sees the locked
      // numbers, not the old allowance carry. Without this the
      // allowance lockdown was local-only.
      // Money keys only (#7 related): with no changedKeys this upsert carried
      // the device's schedule and could revert another device's date moves.
      syncProjectToSupabase(updatedProject, 'upsert', { changedKeys: allowanceLockdownKeys });
    }

    // Sync the package + bid updates to Supabase too. We don't use the
    // per-row updaters here (those would have refired stale closures);
    // we issue the writes directly instead.
    //
    // THE COMMITMENT ITSELF was never written here — it lived only on this
    // device, and the next server load (mergeLocalOnly keeps a local row only
    // while it has a queued write) dropped it, leaving the package pointing at
    // a commitment no one could open and job costing without the sub's cost.
    if (canSync && userId) {
      void touchedWrite(proDocWriteTouchRef, commitment.id, () => supabaseWrite('commitments', 'insert', commitmentToRow(commitment)));
    }
    if (canSync) {
      void supabaseWrite('bid_packages', 'update', {
        id: packageId, name: pkg.name, csi_division: pkg.csiDivision, phase: pkg.phase,
        scope_description: pkg.scopeDescription,
        linked_estimate_item_ids: pkg.linkedEstimateItemIds,
        estimate_budget: pkg.estimateBudget, status: 'awarded',
        due_date: pkg.dueDate, required_by_date: pkg.requiredByDate,
        awarded_bid_id: bidId, awarded_commitment_id: commitmentId,
        buyout_savings: savings, notes: pkg.notes, updated_at: now,
      });
      void supabaseWrite('bid_package_bids', 'update', {
        id: bidId, subcontractor_id: bid.subcontractorId, vendor_name: bid.vendorName,
        amount: bid.amount, includes: bid.includes, excludes: bid.excludes,
        terms: bid.terms, source: bid.source, status: 'awarded',
        normalized_adjustment: bid.normalizedAdjustment,
        normalized_adjustment_reason: bid.normalizedAdjustmentReason,
        notes: bid.notes, updated_at: now,
      });
    }

    return commitmentId;
  }, [bidPackages, bidPackageBids, commitments, projects, saveCommitmentsMutation, saveBidPackagesMutation, saveBidPackageBidsMutation, saveProjectsMutation, syncProjectToSupabase, canSync, userId, commitmentToRow]);

  // ── Client Portal Send / Recall / Batch ───────────────────────────────────
  //
  // These actions mutate per-item portalState + write a notification row to
  // portal_messages. The supabaseWrite offline queue handles network failures
  // — the optimistic local mutation always lands; the server sync flushes
  // when connectivity returns.
  //
  // Snapshot capture: utils/portalSnapshot.freezeForPortal stores the raw
  // item (minus its own portalState) on portalState.lastSentSnapshot, and the
  // portal builder runs it through the same serializer as a live item with the
  // live money/state laid over it — so edits after Send never reach the
  // client, while the balance and the Pay button stay current (blocker #4).
  // A copy over the cap is REFUSED with a reason: truncating it (as this did)
  // produced JSON that never parsed, and the portal quietly showed live edits.
  const captureSnapshot = (kind: SendableItemKind, item: unknown): string => {
    const frozen = freezeForPortal(kind, item);
    if (frozen == null) {
      throw new Error(`This ${itemTypeLabel[kind]} is too large to send to the client portal as one record (over ${Math.round(MAX_PORTAL_SNAPSHOT_BYTES / 1000)} KB). Shorten its notes or line descriptions, then send again.`);
    }
    return frozen;
  };

  const itemTypeLabel: Record<SendableItemKind, string> = {
    change_order: 'Change Order', invoice: 'Invoice', aia_pay_app: 'AIA Pay Application',
    rfi: 'RFI', submittal: 'Submittal',
    daily_report: 'Daily Report', photo: 'Photo', selection: 'Selection', warranty: 'Warranty',
  };

  const tableForKind: Record<SendableItemKind, string> = {
    change_order: 'change_orders', invoice: 'invoices', aia_pay_app: 'aia_pay_apps',
    rfi: 'rfis', submittal: 'submittals',
    daily_report: 'daily_reports', photo: 'photos',
    selection: 'selection_categories', warranty: 'warranties',
  };

  // Every kind reads its LATEST list (#35, #45). A closure list missed an
  // item created earlier in the same handler — Send & Save on a new CO, or an
  // invoice emailed and then shared — and threw "Item not found".
  const findItemByKindAndId = useCallback(
    (kind: SendableItemKind, itemId: string): unknown => {
      switch (kind) {
        case 'change_order': return changeOrdersRef.current.find(i => i.id === itemId);
        case 'invoice':      return invoicesRef.current.find(i => i.id === itemId);
        case 'aia_pay_app':  return aiaPayAppsRef.current.find(i => i.id === itemId);
        case 'rfi':          return rfisRef.current.find(i => i.id === itemId);
        case 'submittal':    return submittalsRef.current.find(i => i.id === itemId);
        case 'daily_report': return dailyReportsRef.current.find(i => i.id === itemId);
        case 'photo':        return projectPhotosRef.current.find(i => i.id === itemId);
        case 'selection':    return undefined; // managed outside ProjectContext via selectionsEngine
        case 'warranty':     return warrantiesRef.current.find(i => i.id === itemId);
      }
    },
    [],
  );

  // Hoisted from the warranty section below — see the note at its original site.
  // Stable (empty deps): setWarranties is a useState setter, WARRANTIES_KEY and
  // saveLocal are module scope.
  const persistWarranties = useCallback((list: Warranty[]) => {
    // #23: a local write — mark the projects it touched against the last list
    // this marked or read (the callers move warrantiesRef before calling).
    markPortalDirty(portalDirtyProjectIds(portalWarrantyBaseRef.current, list));
    portalWarrantyBaseRef.current = list;
    setWarranties(list);
    void saveLocal(WARRANTIES_KEY, list);
  }, [markPortalDirty]);

  // Apply portal-state changes to MANY items in one pass. Every list is mapped
  // and persisted exactly ONCE, no matter how many of its items are in the
  // batch.
  //
  // WHY A BATCH FORM EXISTS. The single-item version reads the state arrays
  // straight out of its closure (`setNext(changeOrders)`), which is correct for
  // one call but silently lossy when called N times in one synchronous tick:
  // React does not re-render mid-loop, so iteration 2 maps over the ORIGINAL
  // array and drops iteration 1's change. batchSendToClientPortal did exactly
  // that, so only the LAST item of each kind kept status 'sent' while `sent++`
  // counted every one. The GC was told "3 items sent to your client" and the
  // Client Outbox still listed 2 of them as drafts; tapping Send all again
  // inserted a SECOND consolidated portal message and re-versioned documents
  // the client already had. Send 10 photos and 9 stayed 'draft' locally — the
  // copy an offline device renders from.
  const applyPortalStates = useCallback(
    (entries: { kind: SendableItemKind; itemId: string; next: PortalState }[]) => {
      if (entries.length === 0) return;
      // kind → (itemId → next). Last write for a given id wins, matching what a
      // sequential loop would have produced.
      const byKind = new Map<SendableItemKind, Map<string, PortalState>>();
      for (const e of entries) {
        let m = byKind.get(e.kind);
        if (!m) { m = new Map(); byKind.set(e.kind, m); }
        m.set(e.itemId, e.next);
      }
      const setNext = <T extends { id: string; portalState?: PortalState }>(
        list: T[], m: Map<string, PortalState>,
      ): T[] => list.map(i => {
        const next = m.get(i.id);
        return next ? { ...i, portalState: next } : i;
      });
      // PERSIST, don't just setState. These setters were React-state-only, so a
      // send or a recall lived in memory and nowhere else: restart the app
      // before a server refetch landed and the local cache still said 'draft'
      // for something already sent (or 'sent' for something recalled). The
      // queued server write was fine — the LOCAL copy was the stale one, which
      // is the copy an offline device renders from.
      // Every list is read from — and written back to — its latest-value ref
      // (#35, #45). A closure list re-mapped here dropped whatever changed
      // since the render it came from: a CO or invoice created earlier in the
      // same handler vanished from his list the moment it was shared.
      for (const [kind, m] of byKind) {
        switch (kind) {
          case 'change_order': { const n = setNext(changeOrdersRef.current, m); changeOrdersRef.current = n; setChangeOrders(n); saveChangeOrdersMutation.mutate(n); break; }
          case 'invoice':      { const n = setNext(invoicesRef.current, m); invoicesRef.current = n; setInvoices(n); saveInvoicesMutation.mutate(n); break; }
          case 'aia_pay_app':  { const n = setNext(aiaPayAppsRef.current, m); aiaPayAppsRef.current = n; setAiaPayApps(n); saveAiaPayAppsMutation.mutate(n); break; }
          // #55 review round: a portal_state write moves the server's
          // updated_at, so this copy's server stamp is no longer current —
          // cleared, and re-read once the write settles (sendToClientPortal).
          case 'rfi':          { const n = setNext(rfisRef.current, m).map(r => (m.has(r.id) ? { ...r, serverUpdatedAt: undefined } : r)); rfisRef.current = n; setRfis(n); saveRfisMutation.mutate(n); break; }
          case 'submittal':    { const n = setNext(submittalsRef.current, m).map(x => (m.has(x.id) ? { ...x, serverUpdatedAt: undefined } : x)); submittalsRef.current = n; setSubmittals(n); saveSubmittalsMutation.mutate(n); break; }
          case 'daily_report': { const n = setNext(dailyReportsRef.current, m); dailyReportsRef.current = n; setDailyReports(n); saveDailyReportsMutation.mutate(n); break; }
          case 'photo':        { const n = setNext(projectPhotosRef.current, m); projectPhotosRef.current = n; setProjectPhotos(n); savePhotosMutation.mutate(n); break; }
          case 'selection':    break; // no-op — managed outside ProjectContext
          // Unlike the branches above, persistWarranties sets the state itself —
          // so there is no separate setWarranties call here.
          case 'warranty':     { const n = setNext(warrantiesRef.current, m); warrantiesRef.current = n; persistWarranties(n); break; }
        }
      }
    },
    // Lists are read through their refs; only the stable setters and the
    // persistence mutations are dependencies.
    [
      setChangeOrders, saveChangeOrdersMutation,
      setInvoices, saveInvoicesMutation,
      setAiaPayApps, saveAiaPayAppsMutation,
      setRfis, saveRfisMutation,
      setSubmittals, saveSubmittalsMutation,
      setDailyReports, saveDailyReportsMutation,
      setProjectPhotos, savePhotosMutation,
      persistWarranties, // persistWarranties owns setWarranties
    ],
  );

  // Single-item convenience wrapper. Safe on its own; NEVER call it in a loop —
  // use applyPortalStates with the whole batch (see the note above).
  const updateItemPortalState = useCallback(
    (kind: SendableItemKind, itemId: string, next: PortalState) => {
      applyPortalStates([{ kind, itemId, next }]);
    },
    [applyPortalStates],
  );

  // #116 (FOUNDER interim: owner / editor only). What reaches the homeowner
  // is the owner's call. A field or viewer seat could send a DFR (or recall
  // one) straight to the client portal, and its portal_messages insert — RLS
  // admits only the project owner — was queued as a write that could never
  // land. The owner passes without a network read; anyone else needs an
  // ACCEPTED editor row, read through the same react-query entry
  // hooks/useProjectCollaborators keeps (a short staleTime: a role changed
  // minutes ago must count). Refused with the reason, before anything moves.
  const portalWriteRefusalFor = useCallback(async (projectId: string): Promise<string | null> => {
    if (!canSync) return null; // signed out: local-only, nothing reaches a portal
    const project = projectsRef.current.find(p => p.id === projectId);
    if (portalWriteRefusal({ project, userId, collaborators: null }) === null) return null;
    let rows: ProjectCollaborator[] | 'error';
    try {
      rows = await queryClient.fetchQuery({
        queryKey: ['project_collaborators', projectId],
        staleTime: 15_000,
        // The hook's own read, row for row (it maps the same columns), so the
        // shared cache entry holds one shape whichever side filled it.
        queryFn: async (): Promise<ProjectCollaborator[]> => {
          const { data, error } = await supabase
            .from('project_collaborators')
            .select('*')
            .eq('project_id', projectId)
            .neq('status', 'revoked')
            .order('invited_at', { ascending: true });
          if (error) throw error;
          return ((data ?? []) as Record<string, unknown>[]).map(r => ({
            id: r.id as string,
            email: r.invited_email as string,
            name: '',
            role: r.role as ProjectCollaborator['role'],
            status: r.status as ProjectCollaborator['status'],
            invitedAt: r.invited_at as string,
            projectId: r.project_id as string,
            userId: (r.user_id as string | null),
            acceptedAt: (r.accepted_at as string | null),
          }) as ProjectCollaborator);
        },
      });
    } catch {
      rows = 'error';
    }
    return portalWriteRefusal({ project, userId, collaborators: rows });
  }, [canSync, userId, queryClient]);

  const sendToClientPortal = useCallback(async ({ kind, itemId, projectId }: { kind: SendableItemKind; itemId: string; projectId: string }): Promise<void> => {
    const refusal = await portalWriteRefusalFor(projectId);
    if (refusal) throw new Error(refusal);
    const found = findItemByKindAndId(kind, itemId);
    if (!found) throw new Error(`Item not found: ${kind}/${itemId}`);
    // Sharing a DRAFT invoice is sending it (utils/invoiceWrites.
    // sharedDraftIssuePatch): issued first, so the client's frozen copy is the
    // sent one and the server row is never a payable draft.
    const issue = kind === 'invoice' ? sharedDraftIssuePatch(found as Invoice, new Date().toISOString()) : null;
    if (issue) updateInvoice(itemId, issue);
    const item = issue ? { ...(found as Invoice), ...issue } : found;

    const prevVersion = (item as { portalState?: PortalState }).portalState?.sentVersion ?? 0;
    const nextPortalState: PortalState = {
      status: 'sent',
      sentAt: new Date().toISOString(),
      sentVersion: prevVersion + 1,
      lastSentSnapshot: captureSnapshot(kind, item),
      // viewedAt cleared on re-send. New sends have no viewedAt.
    };

    updateItemPortalState(kind, itemId, nextPortalState);

    const proj = projects.find(p => p.id === projectId);
    const portalId = proj?.clientPortal?.portalId;

    if (canSync && userId) {
      // Behind a still-queued insert (utils/invoiceWrites.writeBehindQueuedInsert).
      const portalWrite = updateBehindQueuedInsert(tableForKind[kind], {
        id: itemId,
        portal_state: nextPortalState,
        updated_at: new Date().toISOString(),
      });
      // #55 review round: the write moved the row's server updated_at; the
      // re-read hands this copy the new stamp (updateRFI's reopen needs it).
      if (kind === 'rfi' || kind === 'submittal') {
        const listKey = kind === 'rfi' ? 'rfis' : 'submittals';
        void Promise.resolve(portalWrite).then(() => { void queryClient.invalidateQueries({ queryKey: [listKey, userId] }); }, () => {});
      }
      // The notice is the OWNER's to write (RLS admits no one else): an
      // accepted editor's send moves the item's portal_state, but queues no
      // message that could never land. What reaches the page: a RECALL is
      // live on the client's next load whoever made it (the server's
      // portal_overlay_live drops a row no longer shared); a SEND waits for
      // the owner's device to next publish this job — once his app re-reads
      // the lists (open, or back in the foreground) the shared record by
      // another member marks the job (#17, wave 4; see "#23 · The homeowner
      // portal follows his records"), and SendToClientButton tells the editor
      // so (EDITOR_SEND_NOTE).
      if (portalId && portalMessageAllowed(proj, userId)) {
        void writePortalMessage({
          portal_id: portalId,
          project_id: projectId,
          author_type: 'gc',
          body: `📋 New ${itemTypeLabel[kind]} from your builder. Tap to review.`,
          created_at: new Date().toISOString(),
        });
      }
    }
  }, [canSync, userId, projects, findItemByKindAndId, updateItemPortalState, writePortalMessage, updateBehindQueuedInsert, updateInvoice, portalWriteRefusalFor, queryClient]);

  const recallFromClientPortal = useCallback(async ({ kind, itemId, projectId }: { kind: SendableItemKind; itemId: string; projectId: string }): Promise<void> => {
    const refusal = await portalWriteRefusalFor(projectId);
    if (refusal) throw new Error(refusal);
    const item = findItemByKindAndId(kind, itemId);
    if (!item) throw new Error(`Item not found: ${kind}/${itemId}`);

    const prev = (item as { portalState?: PortalState }).portalState;
    const nextPortalState: PortalState = {
      ...prev,
      status: 'recalled',
    };
    updateItemPortalState(kind, itemId, nextPortalState);

    const proj = projects.find(p => p.id === projectId);
    const portalId = proj?.clientPortal?.portalId;

    if (canSync && userId) {
      const portalWrite = updateBehindQueuedInsert(tableForKind[kind], {
        id: itemId,
        portal_state: nextPortalState,
        updated_at: new Date().toISOString(),
      });
      // #55 review round: the write moved the row's server updated_at; the
      // re-read hands this copy the new stamp (updateRFI's reopen needs it).
      if (kind === 'rfi' || kind === 'submittal') {
        const listKey = kind === 'rfi' ? 'rfis' : 'submittals';
        void Promise.resolve(portalWrite).then(() => { void queryClient.invalidateQueries({ queryKey: [listKey, userId] }); }, () => {});
      }
      if (portalId && portalMessageAllowed(proj, userId)) { // owner only — see sendToClientPortal
        void writePortalMessage({
          portal_id: portalId,
          project_id: projectId,
          author_type: 'gc',
          body: `Your builder removed a previously shared ${itemTypeLabel[kind]} — please disregard.`,
          created_at: new Date().toISOString(),
        });
      }
    }
  }, [canSync, userId, projects, findItemByKindAndId, updateItemPortalState, writePortalMessage, updateBehindQueuedInsert, portalWriteRefusalFor, queryClient]);

  const batchSendToClientPortal = useCallback(async (
    { items: requested, projectId }: { items: { kind: SendableItemKind; itemId: string }[]; projectId: string },
  ): Promise<{ sent: number; held: number }> => {
    if (!requested.length) return { sent: 0, held: 0 };
    const refusal = await portalWriteRefusalFor(projectId);
    if (refusal) throw new Error(refusal);
    // #28 (wave 4) · HELD, not sent: an RFI or submittal whose INSERT is still
    // queued. The server numbers every insert itself, so its number here is
    // the phone's guess — and a send freezes the record, number included, into
    // the homeowner's copy, where it never changed to the server's. The
    // Outbox already holds these on the number's state; this is the provider's
    // own rule, so no caller sends one early. A queue that cannot be read
    // holds them too (holding is never wrong; a frozen wrong number is). Held
    // items are left as drafts and counted in `held` — never in `sent`.
    let queue: Awaited<ReturnType<typeof getOfflineQueue>> | null = null;
    try { queue = await getOfflineQueue(); } catch { queue = null; }
    const isHeld = (kind: SendableItemKind, itemId: string) => (kind === 'rfi' || kind === 'submittal')
      && (queue == null || portalSendHeldForNumber(kind, itemId, queue));
    const items = requested.filter(i => !isHeld(i.kind, i.itemId));
    const held = requested.length - items.length;
    if (!items.length) return { sent: 0, held };

    // Mutate each item's local state + queue the per-row table updates.
    // CRITICAL: do NOT call sendToClientPortal in a loop — that would
    // create N portal_messages rows. Inline the mutations here, then write
    // exactly ONE consolidated portal_messages summary row at the end.
    const nowIso = new Date().toISOString();
    let sent = 0;
    const counts: Partial<Record<SendableItemKind, number>> = {};
    // Collected, then applied in ONE pass per kind. Calling the single-item
    // updateItemPortalState here (as this used to) made every iteration map
    // over the same pre-loop array, so only the last item of each kind stayed
    // 'sent' locally while `sent` counted all of them — "3 items sent" with 2
    // still sitting in the outbox as drafts.
    const portalUpdates: { kind: SendableItemKind; itemId: string; next: PortalState }[] = [];
    // Freeze EVERY copy before anything is written: one record too large to
    // freeze refuses the whole batch with its reason, instead of leaving half
    // the batch sent and the summary message unwritten.
    // A draft invoice in the batch is frozen as the SENT copy and issued
    // below, only once it is actually going out (sharedDraftIssuePatch).
    const issues = items.map(({ kind, itemId }) => {
      const found = findItemByKindAndId(kind, itemId);
      return found && kind === 'invoice' ? sharedDraftIssuePatch(found as Invoice, nowIso) : null;
    });
    const resolved = items.map(({ kind, itemId }, index) => {
      const found = findItemByKindAndId(kind, itemId);
      const issue = issues[index];
      return found && issue ? { ...(found as Invoice), ...issue } : found;
    });
    const frozenCopies = items.map(({ kind }, index) => {
      const item = resolved[index];
      return item ? captureSnapshot(kind, item) : null;
    });
    for (const [index, { kind, itemId }] of items.entries()) {
      const item = resolved[index];
      const frozen = frozenCopies[index];
      if (!item || frozen == null) continue;
      const issue = issues[index];
      if (issue) updateInvoice(itemId, issue);
      const prevVersion = (item as { portalState?: PortalState }).portalState?.sentVersion ?? 0;
      const next: PortalState = {
        status: 'sent',
        sentAt: nowIso,
        sentVersion: prevVersion + 1,
        lastSentSnapshot: frozen,
      };
      portalUpdates.push({ kind, itemId, next });
      if (canSync && userId) {
        const portalWrite = updateBehindQueuedInsert(tableForKind[kind], {
          id: itemId,
          portal_state: next,
          updated_at: nowIso,
        });
        // #55 review round: see sendToClientPortal — the new server stamp.
        if (kind === 'rfi' || kind === 'submittal') {
          const listKey = kind === 'rfi' ? 'rfis' : 'submittals';
          void Promise.resolve(portalWrite).then(() => { void queryClient.invalidateQueries({ queryKey: [listKey, userId] }); }, () => {});
        }
      }
      counts[kind] = (counts[kind] ?? 0) + 1;
      sent++;
    }
    applyPortalStates(portalUpdates);

    // Build a consolidated summary message: "3 new updates from your builder:
    // 1 Change Order, 1 RFI, 1 Daily Report"
    const proj = projects.find(p => p.id === projectId);
    const portalId = proj?.clientPortal?.portalId;

    if (canSync && userId && portalId && portalMessageAllowed(proj, userId)) { // owner only — see sendToClientPortal
      const parts: string[] = [];
      for (const k of Object.keys(counts) as SendableItemKind[]) {
        const n = counts[k]!;
        parts.push(`${n} ${itemTypeLabel[k]}${n === 1 ? '' : 's'}`);
      }
      const body = `${sent} new update${sent === 1 ? '' : 's'} from your builder: ${parts.join(', ')}`;
      void writePortalMessage({
        portal_id: portalId,
        project_id: projectId,
        author_type: 'gc',
        body,
        created_at: nowIso,
      });
    }

    return { sent, held };
  }, [canSync, userId, projects, findItemByKindAndId, applyPortalStates, writePortalMessage, updateBehindQueuedInsert, updateInvoice, portalWriteRefusalFor, queryClient]);

  const addSubcontractor = useCallback((sub: Subcontractor) => {
    const updated = [sub, ...subcontractors];
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('subcontractors', 'insert', {
        id: sub.id, user_id: userId, company_name: sub.companyName, contact_name: sub.contactName,
        phone: sub.phone, email: sub.email, address: sub.address, trade: sub.trade,
        license_number: sub.licenseNumber, license_expiry: sub.licenseExpiry, coi_expiry: sub.coiExpiry,
        w9_on_file: sub.w9OnFile, bid_history: sub.bidHistory, assigned_projects: sub.assignedProjects,
        notes: sub.notes, created_at: sub.createdAt, updated_at: sub.updatedAt,
        // CONTRACT 17: only the ones this copy holds a value for.
        ...subcontractorExtraColumns(sub),
      });
    }
  }, [subcontractors, saveSubsMutation, canSync, userId]);

  const updateSubcontractor = useCallback((id: string, updates: Partial<Subcontractor>) => {
    const now = new Date().toISOString();
    const before = subcontractors.find(s => s.id === id);
    const updated = subcontractors.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    // A rename carries onto his punch items (utils/subPortalSnapshot
    // punchItemsFollowingSubRename) — otherwise they fall off his portal and
    // the next edit of any of them clears assigned_sub_id. Through the ref:
    // updatePunchItems is declared further down.
    if (before && typeof updates.companyName === 'string') {
      const newName = updates.companyName.trim();
      // Name-only rows only on HIS projects: the ref also holds the owner's
      // rows on jobs he was invited to (see punchItemsFollowingSubRename).
      const follow = punchItemsFollowingSubRename(punchItemsRef.current, before, before.companyName, newName, subcontractors, ownsProjectFor(projectsRef.current, userId));
      if (follow.length > 0) updatePunchItemsRef.current?.(follow, { assignedSub: newName, assignedSubId: id });
    }
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('subcontractors', 'update', {
          id, company_name: s.companyName, contact_name: s.contactName, phone: s.phone, email: s.email,
          address: s.address, trade: s.trade, license_number: s.licenseNumber, license_expiry: s.licenseExpiry,
          coi_expiry: s.coiExpiry, w9_on_file: s.w9OnFile, bid_history: s.bidHistory,
          assigned_projects: s.assignedProjects, notes: s.notes, updated_at: now,
          // CONTRACT 17: only the ones this copy holds a value for, so a copy
          // that never loaded a stamp cannot null one set on another device.
          ...subcontractorExtraColumns(s),
        });
      }
    }
  }, [subcontractors, saveSubsMutation, canSync, userId]);

  const deleteSubcontractor = useCallback((id: string) => {
    const updated = subcontractors.filter(s => s.id !== id);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) void supabaseWrite('subcontractors', 'delete', { id });
  }, [subcontractors, saveSubsMutation, canSync]);

  const getSubcontractor = useCallback((id: string) => subcontractors.find(s => s.id === id) ?? null, [subcontractors]);

  // A punch photo is the deficiency's evidence — it has to outlive the device
  // that shot it. Same treatment as the gallery: bytes onto the upload queue,
  // durable path onto the row, local URI kept for rendering. Keyed
  // `punch-<id>` so it can't collide with the gallery photo of the same id.
  const stagePunchPhoto = useCallback((item: PunchItem): PunchItem => {
    if (!item.photoUri) return item;
    if (!isDeviceLocalUri(item.photoUri)) {
      // #12, punch side. An item raised from a gallery photo that is NOT on
      // this device (the office marking up a field photo) arrives with that
      // photo's SIGNED URL, which expires in 24 h (utils/storage
      // PHOTO_URL_TTL_SECONDS) — after that the punch photo and the sub's
      // copy stopped loading. The gallery photo's storage path is durable:
      // put it on the item, so punchItemToRow writes the path and every load
      // signs a fresh URL. Read through the ref — the photo list this
      // callback closed over can be a render old.
      if (!item.photoStoragePath && item.sourcePhotoId) {
        const source = projectPhotosRef.current.find(p => p.id === item.sourcePhotoId);
        if (source?.storagePath) return { ...item, photoStoragePath: source.storagePath };
      }
      return item;
    }
    // Already staged THIS exact file — every unrelated edit (status change,
    // reassignment, closing the item) runs through here, and re-staging would
    // re-copy the image to disk each time. A genuinely replaced photo has a
    // different URI and does fall through.
    if (item.photoStoragePath && item.photoLocalUri === item.photoUri) return item;
    const storagePath = stagePhotoUpload({
      userId, projectId: item.projectId, recordId: `punch-${item.id}`, localUri: item.photoUri,
    });
    if (!storagePath) return item;
    return { ...item, photoStoragePath: storagePath, photoLocalUri: item.photoUri };
  }, [userId]);

  // Snake/camel mapping for the punch_items insert payload — shared by the
  // single-add and batch-add paths so they stay byte-identical.
  const punchItemToRow = useCallback((item: PunchItem) => ({
    id: item.id, user_id: userId, project_id: item.projectId, description: item.description,
    location: item.location, assigned_sub: item.assignedSub, assigned_sub_id: item.assignedSubId,
    // #3 (wave 4): punch_items.due_date is NOT NULL with no default, and
    // JSON drops an undefined key — so a caller that left dueDate out (the
    // Brain mic, the sample jobs, anything cast past the type) sent an INSERT
    // with no due_date, was refused 23502, and the item then vanished on the
    // next read. Blank is what every creation screen sends for "no due date".
    due_date: item.dueDate ?? '', priority: item.priority, status: item.status,
    // Durable path, never the local `file://`.
    // `|| null` because punch_items.photo_uri is nullable and "no photo" must
    // stay NULL — photos.uri is NOT NULL, so that one keeps the empty string.
    photo_uri: durablePhotoValue(item.photoStoragePath, item.photoUri) || null,
    // Plan-pin anchor + captured GPS. Client camelCase → snake_case column
    // (see migration 20260707120000_punch_location.sql). Previously omitted,
    // so this data was captured locally then silently dropped on sync.
    plan_sheet_id: item.planSheetId, pin_x: item.pinX, pin_y: item.pinY,
    photo_latitude: item.photoLatitude, photo_longitude: item.photoLongitude,
    photo_accuracy_meters: item.photoLocationAccuracyMeters,
    photo_location_label: item.photoLocationLabel,
    // Always an explicit value, resolved through the one default — an absent
    // listType is a formal punch item (migration 20260916120000_punch_list_type.sql).
    list_type: punchListTypeOf(item),
    // The photo the item was raised from — how another device finds its markup.
    // Only when set, like punchItemToUpdateRow.
    ...(item.sourcePhotoId ? { source_photo_id: item.sourcePhotoId } : {}),
    rejection_note: item.rejectionNote, closed_at: item.closedAt,
    created_at: item.createdAt, updated_at: item.updatedAt,
  }), [userId]);

  // #111: the creator on the LOCAL copy too (the insert row already writes
  // user_id), so an item raised from any screen — ai-punch, the annotator, a
  // drawing pin — passes the "you added it" delete gate before a refetch.
  const stampPunchCreator = useCallback((pi: PunchItem): PunchItem => (
    pi.createdByUserId || !userId ? pi : { ...pi, createdByUserId: userId }
  ), [userId]);

  const addPunchItem = useCallback((rawItem: PunchItem) => {
    const item = stagePunchPhoto(stampPunchCreator(rawItem));
    // Read the ref (not `punchItems`) so a later synchronous call in the same
    // tick sees this row — keeps single-add composable with the batch path.
    const updated = [item, ...punchItemsRef.current];
    punchItemsRef.current = updated;
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, item.id, () => supabaseWrite('punch_items', 'insert', punchItemToRow(item)));
  }, [savePunchItemsMutation, canSync, punchItemToRow, stagePunchPhoto, stampPunchCreator]);

  // Batch insert — prepends the WHOLE array in ONE setState via the ref, so all
  // N rows survive (the single-add read `punchItems` from a stale closure, so a
  // caller looping it kept only the last). One supabaseWrite per row, same shape.
  const addPunchItems = useCallback((rawItems: PunchItem[]) => {
    if (rawItems.length === 0) return;
    const items = rawItems.map(pi => stagePunchPhoto(stampPunchCreator(pi)));
    // Newest-first: reverse so the first input ends up last after prepending,
    // matching the single-add ordering when called in sequence.
    const updated = [...[...items].reverse(), ...punchItemsRef.current];
    punchItemsRef.current = updated;
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) items.forEach(item => { void touchedWrite(proDocWriteTouchRef, item.id, () => supabaseWrite('punch_items', 'insert', punchItemToRow(item))); });
  }, [savePunchItemsMutation, canSync, punchItemToRow, stagePunchPhoto, stampPunchCreator]);

  // Pin writes per item, in the order he made them. Save pin then Undo two
  // seconds later are two UPDATEs to the same row: sent independently, the Undo
  // could land first, or the Save could time out into the queue while the Undo
  // went direct — and the flush then replayed the pin over his Undo.
  const pinWriteChainRef = useRef(new Map<string, Promise<WriteOutcome>>());
  useEffect(() => { pinWriteChainRef.current = new Map(); }, [userId]);

  // A pin gesture — see punchPinScopedRow. Same local path as updatePunchItems
  // (ref, one setState, one save), but the server gets only the pin/GPS columns.
  const updatePunchItemPin = useCallback((id: string, fields: PinScopedPatch) => {
    const now = new Date().toISOString();
    const scoped = pinScopedPatchOf(fields);
    if (Object.keys(scoped).length === 0) return;
    const { next, changed } = applyPunchBatchUpdate(punchItemsRef.current, [id], scoped, now);
    if (changed.length === 0) return;
    punchItemsRef.current = next;
    setPunchItems(next);
    savePunchItemsMutation.mutate(next);
    if (!canSync) return;
    const row = punchPinScopedRow(id, scoped, now);
    const chains = pinWriteChainRef.current;
    const prev = chains.get(id);
    const run = async (): Promise<WriteOutcome> => {
      const prevOutcome = prev ? await prev.catch((): WriteOutcome => 'failed') : null;
      // Anything for this row still in the queue (the previous pin write, the
      // item's own INSERT from a walk in the basement) must land first: go
      // behind it, the flush replays FIFO. A queue we cannot read counts as
      // holding it — queuing is never wrong, overtaking is.
      let behindQueue = prevOutcome === 'queued';
      if (!behindQueue) {
        try { behindQueue = (await queuedIdsFor('punch_items')).has(id); } catch { behindQueue = true; }
      }
      if (behindQueue) {
        try { await addToOfflineQueue({ table: 'punch_items', operation: 'update', data: row }); return 'queued'; } catch { return 'failed'; }
      }
      return supabaseWriteDetailed('punch_items', 'update', row);
    };
    const p = run();
    chains.set(id, p);
    // Drop the link once it is the tail, so the map does not grow per item forever.
    void p.finally(() => { if (pinWriteChainRef.current.get(id) === p) pinWriteChainRef.current.delete(id); });
    trackPinWrite(id, pinScopedPatchCarriesPin(scoped), p);
  }, [savePunchItemsMutation, canSync, trackPinWrite]);

  // Batch update — see the punch-batch pure block at the top of this file.
  // Reads and writes the ref (like addPunchItems), not the `punchItems`
  // closure: two calls in the same tick — or an update right after an add —
  // must each see the other, or the last setState wins and earlier edits
  // vanish locally while their Supabase writes still land.
  const updatePunchItems = useCallback((ids: readonly string[], updates: PunchBatchUpdates) => {
    const now = new Date().toISOString();
    // A photo attached AFTER creation (the common punch-walk flow: log the
    // deficiency, shoot it later) has to be staged here too.
    const { next, changed, cleared, touched } = applyPunchBatchUpdate(punchItemsRef.current, ids, updates, now, stagePunchPhoto);
    if (changed.length === 0) return;
    punchItemsRef.current = next;
    setPunchItems(next);
    savePunchItemsMutation.mutate(next);
    // One queued write PER ROW, same payload as a single edit — so an offline
    // replay of a 100-item close is 100 independent, retryable updates. A
    // write that touches the pin is tracked, so a refetch that races it keeps
    // the pin on screen (keepPendingPinFields in the loader).
    if (canSync) changed.forEach(pi => { trackPinWrite(pi.id, rowCarriesPin(pi, cleared[pi.id] ?? []), touchedWrite(proDocWriteTouchRef, pi.id, () => supabaseWrite('punch_items', 'update', punchItemToUpdateRow(pi, now, cleared[pi.id], touched[pi.id] ?? [])))); });
  }, [savePunchItemsMutation, canSync, stagePunchPhoto, trackPinWrite]);

  updatePunchItemsRef.current = updatePunchItems;

  // The single edit is the batch of one, so the two paths cannot drift.
  const updatePunchItem = useCallback((id: string, updates: Partial<PunchItem>) => {
    updatePunchItems([id], updates);
  }, [updatePunchItems]);

  const deletePunchItems = useCallback((ids: readonly string[]) => {
    const { next, removed } = applyPunchBatchDelete(punchItemsRef.current, ids);
    if (removed.length === 0) return;
    punchItemsRef.current = next;
    setPunchItems(next);
    savePunchItemsMutation.mutate(next);
    if (canSync) removed.forEach(pi => { void supabaseWrite('punch_items', 'delete', { id: pi.id }); });
  }, [savePunchItemsMutation, canSync]);

  const deletePunchItem = useCallback((id: string) => {
    deletePunchItems([id]);
  }, [deletePunchItems]);

  // What consumers see: a legacy item saved with a (now expired) signed URL
  // renders from its source gallery photo instead (utils/punchSourcePhoto).
  // Raw `punchItems` stays the write-side state; stagePunchPhoto heals the row
  // itself on the item's next edit.
  const punchItemsView = useMemo(() => withSourcePhotoUris(punchItems, projectPhotos), [punchItems, projectPhotos]);
  const getPunchItemsForProject = useCallback((projectId: string) => punchItemsView.filter(pi => pi.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [punchItemsView]);

  const addProjectPhoto = useCallback((photo: ProjectPhoto) => {
    // Queue the bytes and reserve the durable path BEFORE anything is written.
    // `photo.uri` stays local in state so the gallery paints this frame.
    const storagePath = photo.storagePath ?? stagePhotoUpload({
      userId, projectId: photo.projectId, recordId: photo.id, localUri: photo.uri,
    }) ?? undefined;
    const finalPhoto: ProjectPhoto = {
      ...photo,
      storagePath,
      localUri: photo.localUri ?? (isDeviceLocalUri(photo.uri) ? photo.uri : undefined),
      portalState: photo.portalState ?? initialPortalState('photo', photo.projectId),
    };
    // Functional updater: a daily-report save calls this N times synchronously
    // before React re-renders, so reading the closure-captured `projectPhotos`
    // made each call clobber the previous — the gallery kept only the last of
    // several photos. `prev` composes the batched adds correctly.
    setProjectPhotos(prev => {
      const updated = [finalPhoto, ...prev];
      // Keep the live ref current too, so an updateProjectPhoto in the same
      // tick (before the commit effect runs) finds this photo.
      projectPhotosRef.current = updated;
      savePhotosMutation.mutate(updated);
      return updated;
    });
    if (canSync) {
      // Tracked (#23 round 2): see addDailyReport.
      void touchedWrite(proDocWriteTouchRef, finalPhoto.id, () => supabaseWrite('photos', 'insert', {
        id: finalPhoto.id, user_id: userId, project_id: finalPhoto.projectId,
        // The DURABLE path, never the device-local URI — that was the bug.
        uri: durablePhotoValue(storagePath, finalPhoto.uri),
        timestamp: finalPhoto.timestamp, location: finalPhoto.location, tag: finalPhoto.tag,
        linked_task_id: finalPhoto.linkedTaskId, linked_task_name: finalPhoto.linkedTaskName,
        markup: finalPhoto.markup, created_at: finalPhoto.createdAt,
        portal_state: finalPhoto.portalState,
        // #65 (CONTRACT 18): the capture's geo stamp, when it has one.
        ...photoGeoColumns(finalPhoto),
      }));
    }
  }, [savePhotosMutation, canSync, userId, initialPortalState]);

  const deleteProjectPhoto = useCallback((id: string) => {
    const doomed = projectPhotos.find(p => p.id === id);
    const updated = projectPhotos.filter(p => p.id !== id);
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) {
      void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('photos', 'delete', { id }));
      // Reap the object too, or deleting photos would grow the bucket forever
      // with objects nothing references — UNLESS a daily report still shows the
      // same image. DFR photos are mirrored into the gallery under the same id,
      // so they share one object; removing it here would blank a photo out of a
      // filed report, which is a document we must not alter after the fact.
      // …or a punch item: an item raised from a gallery photo (web, or photo
      // triage) carries that photo's storage path (stagePunchPhoto #12), so
      // deleting the gallery copy must not take the punch photo's bytes
      // (photo-ai, wave 5).
      const stillReferenced = doomed?.storagePath
        ? dailyReports.some(dr => (dr.photos ?? []).some(p => p.storagePath === doomed.storagePath))
          || punchItemsRef.current.some(pi => pi.photoStoragePath === doomed.storagePath)
        : true;
      if (doomed?.storagePath && !stillReferenced) void deleteProjectPhotoObject(doomed.storagePath);
    }
  }, [projectPhotos, savePhotosMutation, canSync, dailyReports]);

  // Patch a photo in place — used by the annotator to save markup, by the
  // gallery to retag, and by clients downstream that want to update a
  // caption / location without re-uploading the image.
  const updateProjectPhoto = useCallback((id: string, updates: Partial<ProjectPhoto>) => {
    // Read the LIVE list (ref), never the closure's `projectPhotos`: a late
    // caller — project-detail's GPS stamp lands 1-4.5 s after the capture, via
    // the updateProjectPhoto it captured when the tap started — holds a copy
    // from before its own photo was added, and mapping that copy dropped the
    // new photo from the gallery and the device cache (#65 late stamp).
    const existing = projectPhotosRef.current.find(p => p.id === id);
    // A caller replacing the image (e.g. a re-shot photo) hands us a fresh
    // local URI. Stage its bytes and reserve a path here too, or this write
    // would re-introduce a `file://` through the side door.
    const nextStoragePath = updates.storagePath
      ?? (updates.uri !== undefined && existing
        ? stagePhotoUpload({ userId, projectId: existing.projectId, recordId: id, localUri: updates.uri }) ?? undefined
        : undefined)
      ?? existing?.storagePath;
    const patched: Partial<ProjectPhoto> = {
      ...updates,
      ...(nextStoragePath ? { storagePath: nextStoragePath } : {}),
      ...(updates.uri !== undefined && isDeviceLocalUri(updates.uri) ? { localUri: updates.uri } : {}),
    };
    // Functional updater, like addProjectPhoto: `prev` is the committed list
    // including adds React hasn't rendered yet.
    setProjectPhotos(prev => {
      const updated = prev.map(p => p.id === id ? { ...p, ...patched } : p);
      projectPhotosRef.current = updated;
      savePhotosMutation.mutate(updated);
      return updated;
    });
    if (canSync) {
      const patch: Record<string, unknown> = { id };
      if (updates.uri !== undefined) patch.uri = durablePhotoValue(nextStoragePath, updates.uri);
      if (updates.location !== undefined) patch.location = updates.location;
      if (updates.tag !== undefined) patch.tag = updates.tag;
      if (updates.linkedTaskId !== undefined) patch.linked_task_id = updates.linkedTaskId;
      if (updates.linkedTaskName !== undefined) patch.linked_task_name = updates.linkedTaskName;
      if (updates.markup !== undefined) patch.markup = updates.markup;
      // #65 (CONTRACT 18): a late geo stamp (the fix arrived after the photo
      // was saved) — only the fields the caller passed.
      Object.assign(patch, photoGeoColumns(updates));
      // An update that changes no column would send `{ id }` alone — nothing
      // to write, and a PATCH with an empty body is not a thing to queue.
      if (Object.keys(patch).length > 1) {
        void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('photos', 'update', patch));
      }
    }
  }, [savePhotosMutation, canSync, userId]);

  const getPhotosForProject = useCallback((projectId: string) => projectPhotos.filter(p => p.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [projectPhotos]);

  const addPriceAlert = useCallback((alert: PriceAlert) => {
    const updated = [alert, ...priceAlerts];
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('price_alerts', 'insert', {
        id: alert.id, user_id: userId, material_id: alert.materialId, material_name: alert.materialName,
        target_price: alert.targetPrice, direction: alert.direction, current_price: alert.currentPrice,
        is_triggered: alert.isTriggered, is_paused: alert.isPaused, created_at: alert.createdAt,
      });
    }
  }, [priceAlerts, savePriceAlertsMutation, canSync, userId]);

  const updatePriceAlert = useCallback((id: string, updates: Partial<PriceAlert>) => {
    const updated = priceAlerts.map(a => a.id === id ? { ...a, ...updates } : a);
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) {
      const a = updated.find(x => x.id === id);
      if (a) {
        void supabaseWrite('price_alerts', 'update', {
          id, target_price: a.targetPrice, direction: a.direction, current_price: a.currentPrice,
          is_triggered: a.isTriggered, is_paused: a.isPaused,
        });
      }
    }
  }, [priceAlerts, savePriceAlertsMutation, canSync]);

  const deletePriceAlert = useCallback((id: string) => {
    const updated = priceAlerts.filter(a => a.id !== id);
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) void supabaseWrite('price_alerts', 'delete', { id });
  }, [priceAlerts, savePriceAlertsMutation, canSync]);

  const addContact = useCallback((contact: Contact) => {
    const updated = [contact, ...contacts];
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('contacts', 'insert', {
        id: contact.id, user_id: userId, first_name: contact.firstName, last_name: contact.lastName,
        company_name: contact.companyName, role: contact.role, email: contact.email,
        secondary_email: contact.secondaryEmail, phone: contact.phone, address: contact.address,
        notes: contact.notes, linked_project_ids: contact.linkedProjectIds,
        created_at: contact.createdAt, updated_at: contact.updatedAt,
      });
    }
  }, [contacts, saveContactsMutation, canSync, userId]);

  const updateContact = useCallback((id: string, updates: Partial<Contact>) => {
    const now = new Date().toISOString();
    const updated = contacts.map(c => c.id === id ? { ...c, ...updates, updatedAt: now } : c);
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) {
      const c = updated.find(x => x.id === id);
      if (c) {
        void supabaseWrite('contacts', 'update', {
          id, first_name: c.firstName, last_name: c.lastName, company_name: c.companyName,
          role: c.role, email: c.email, secondary_email: c.secondaryEmail, phone: c.phone,
          address: c.address, notes: c.notes, linked_project_ids: c.linkedProjectIds, updated_at: now,
        });
      }
    }
  }, [contacts, saveContactsMutation, canSync]);

  const deleteContact = useCallback((id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) void supabaseWrite('contacts', 'delete', { id });
  }, [contacts, saveContactsMutation, canSync]);

  const getContact = useCallback((id: string) => contacts.find(c => c.id === id) ?? null, [contacts]);

  const addCommEvent = useCallback((event: CommunicationEvent) => {
    const updated = [event, ...commEvents];
    setCommEvents(updated);
    saveCommEventsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('comm_events', 'insert', {
        id: event.id, user_id: userId, project_id: event.projectId, type: event.type,
        summary: event.summary, actor: event.actor, recipient: event.recipient,
        detail: event.detail, is_private: event.isPrivate, timestamp: event.timestamp,
      });
    }
  }, [commEvents, saveCommEventsMutation, canSync, userId]);

  const getCommEventsForProject = useCallback((projectId: string) => commEvents.filter(e => e.projectId === projectId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [commEvents]);

  // Returns the created RFI so callers (e.g. UniversalMicButton) can
  // navigate to /rfi?rfiId=<new id> immediately, without racing on a stale
  // closure of getRFIsForProject. Without this, the post-create navigation
  // resolves to undefined and the RFI screen opens in "new" mode with
  // empty fields — visible to the user as a "blank RFI" even though the
  // actual saved row was filled correctly.
  // Snake/camel mapping for the rfis row — every column an EDIT may change.
  // Shared by insert (via rfiToRow) and update so the two cannot drift.
  //
  // WHY THIS EXISTS. updateRFI used to hand-list its columns and omitted four
  // that the RFI screen edits: date_required, submitted_by, linked_drawing and
  // linked_task_id. All four are written on INSERT and read back by the rfis
  // mapper, which then calls saveLocal(RFIS_KEY, mapped) — so the next refetch
  // pulled the SERVER's stale values over the edit AND destroyed the local
  // copy. A GC who granted the architect a two-week extension watched the date
  // revert on the next launch with no error, and dateRequired drives the whole
  // overdue machinery (systemOfAction's chase list and its auto-drafted nudge,
  // oacEngine agenda aging, the red overdue flag on the RFI Log PDF) — so the
  // app kept chasing against a deadline they had already moved.
  const rfiMutableRow = useCallback((r: RFI) => ({
    id: r.id,
    subject: r.subject, question: r.question, submitted_by: r.submittedBy,
    assigned_to: r.assignedTo, assigned_sub_id: r.assignedSubId ?? null,
    ball_in_court: r.ballInCourt ?? null, handoffs: r.handoffs ?? null,
    date_submitted: r.dateSubmitted, date_required: r.dateRequired,
    date_responded: r.dateResponded ?? null, response: r.response ?? null,
    status: r.status, priority: r.priority,
    linked_drawing: r.linkedDrawing ?? null, linked_task_id: r.linkedTaskId ?? null,
    attachments: r.attachments, updated_at: r.updatedAt,
    // Only when set (see punchItemToUpdateRow): the column is new, and naming
    // it on every RFI write would stall them all until 20260917180000 lands.
    ...(r.sourcePhotoId ? { source_photo_id: r.sourcePhotoId } : {}),
  }), []);

  // Insert payload — the mutable columns plus the insert-only ones. Shared by
  // single-add and batch-add so the two write the same shape.
  const rfiToRow = useCallback((newRfi: RFI) => ({
    ...rfiMutableRow(newRfi),
    user_id: userId, project_id: newRfi.projectId, number: newRfi.number,
    created_at: newRfi.createdAt, portal_state: newRfi.portalState,
    // #30: the device-minted reply token, on the INSERT only (never in
    // rfiMutableRow, so no update can null it). Absent when the mint fell
    // back — the column default then gives the row one.
    ...(newRfi.shareToken ? { share_token: newRfi.shareToken } : {}),
  }), [userId, rfiMutableRow]);

  // Next per-project RFI number given an authoritative current array (`base`).
  // RFI numbers are per project — one advancing counter per projectId.
  const nextRfiNumber = useCallback((projectId: string, base: RFI[]) => {
    const projectRfis = base.filter(r => r.projectId === projectId);
    return projectRfis.length > 0 ? Math.max(...projectRfis.map(r => r.number)) + 1 : 1;
  }, []);

  // #32 (wave 4) · A batch of RFIs / submittals (spec-book import, photo
  // triage) must reach the server in the order he created them: the server
  // numbers each INSERT under a per-project lock in ARRIVAL order, so twenty
  // fired at once let the network pick the numbers and the log he saw as
  // #1-#20 in spec order came back permuted. The order is kept by
  // utils/offlineQueue — a numbered create holds a per-project slot, so each
  // waits for the one before it, and once one has fallen into the queue every
  // later one is queued behind it (never sent live to take a lower number).
  // What this must do is hand the rows over IN CREATION ORDER and IN THIS
  // TICK: each row's own slot is then held from now, so an edit of row 7
  // made while rows 1-6 are still going cannot overtake row 7's INSERT (an
  // earlier version awaited each row before handing over the next, which
  // left the later rows' slots free — an edit then matched 0 rows and was
  // lost). Each row is touched while it is out.
  const sendNumberedInsertsInOrder = useCallback((table: 'rfis' | 'submittals', rows: readonly Record<string, unknown>[]): void => {
    for (const row of rows) {
      void touchedWrite(proDocWriteTouchRef, String(row.id ?? ''), () => supabaseWrite(table, 'insert', row));
    }
  }, []);

  const addRFI = useCallback((rfi: Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'>): RFI => {
    // Read the ref (not `rfis`) so numbering stays correct when this is called
    // N times in one synchronous loop before React re-renders.
    const base = rfisRef.current;
    const now = new Date().toISOString();
    const newRfi: RFI = {
      ...rfi,
      id: generateUUID(),
      number: nextRfiNumber(rfi.projectId, base),
      createdAt: now,
      updatedAt: now,
      portalState: rfi.portalState ?? initialPortalState('rfi', rfi.projectId),
      // #30: always a fresh token (never a copied one), from the CSPRNG.
      shareToken: mintShareToken(),
    };
    const updated = [newRfi, ...base];
    rfisRef.current = updated;
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, newRfi.id, () => supabaseWrite('rfis', 'insert', rfiToRow(newRfi)));
    return newRfi;
  }, [saveRfisMutation, canSync, initialPortalState, nextRfiNumber, rfiToRow]);

  // Batch insert — prepends the WHOLE array in ONE setState via the ref, and
  // assigns SEQUENTIAL per-project numbers off an advancing counter seeded from
  // the current max (the single-add recomputed from a stale closure every
  // iteration, so batch RFIs all collided on the same number and only the last
  // survived). Only `number` is assigned/overridden — all caller fields (id,
  // title, description, etc.) are preserved.
  const addRFIs = useCallback((incoming: RFI[]) => {
    if (incoming.length === 0) return;
    let working = rfisRef.current;
    const rows: Record<string, unknown>[] = [];
    for (const rfi of incoming) {
      const now = new Date().toISOString();
      const newRfi: RFI = {
        ...rfi,
        number: nextRfiNumber(rfi.projectId, working),
        createdAt: rfi.createdAt ?? now,
        updatedAt: rfi.updatedAt ?? now,
        portalState: rfi.portalState ?? initialPortalState('rfi', rfi.projectId),
        // #30: as addRFI — a fresh CSPRNG token per new record.
        shareToken: mintShareToken(),
      };
      // Prepend so `working` carries this row's number into the next
      // iteration's max — advancing the per-project counter by one.
      working = [newRfi, ...working];
      rows.push(rfiToRow(newRfi));
    }
    rfisRef.current = working;
    setRfis(working);
    saveRfisMutation.mutate(working);
    if (canSync) sendNumberedInsertsInOrder('rfis', rows);
  }, [saveRfisMutation, canSync, initialPortalState, nextRfiNumber, rfiToRow, sendNumberedInsertsInOrder]);

  // #55 review round · After his own write lands, take the server's new
  // updated_at as this copy's stamp — but only when the server's guarded
  // columns are what this device wrote (serverStampAdoptable) and no later
  // edit went out; otherwise re-read the list, which carries the right stamp.
  const adoptProDocStamp = useCallback(async (table: 'rfis' | 'submittals', id: string, seq: number) => {
    const key = `${table}:${id}`;
    const owner = userId;
    const reread = () => { void queryClient.invalidateQueries({ queryKey: [table, owner] }); };
    try {
      const cols = table === 'rfis' ? RFI_GUARDED_COLUMNS : SUBMITTAL_GUARDED_COLUMNS;
      const { data, error } = await supabase.from(table).select(['updated_at', ...cols].join(', ')).eq('id', id).maybeSingle();
      if (proDocEditSeqRef.current.get(key) !== seq || liveUserIdRef.current !== owner) return;
      if (error || !data) { reread(); return; }
      const row = data as unknown as Record<string, unknown>;
      if (table === 'rfis') {
        const local = rfisRef.current.find(r => r.id === id);
        if (!local || !serverStampAdoptable(rfiMutableRow(local), row, cols)) { reread(); return; }
        const list = rfisRef.current.map(r => (r.id === id ? { ...r, serverUpdatedAt: row.updated_at as string } : r));
        rfisRef.current = list;
        setRfis(list);
        saveRfisMutation.mutate(list);
      } else {
        const local = submittalsRef.current.find(x => x.id === id);
        if (!local || !serverStampAdoptable(submittalMutableRow(local), row, cols)) { reread(); return; }
        const list = submittalsRef.current.map(x => (x.id === id ? { ...x, serverUpdatedAt: row.updated_at as string } : x));
        submittalsRef.current = list;
        setSubmittals(list);
        saveSubmittalsMutation.mutate(list);
      }
    } catch {
      reread();
    }
  // The row builders are declared below this line (same render); they are
  // stable useCallbacks over userId.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, queryClient, saveRfisMutation, saveSubmittalsMutation]);

  // Sends one RFI / submittal patch, then adopts the server's stamp once it
  // lands directly (a queued write is re-read after its flush instead).
  const sendProDocPatch = useCallback((table: 'rfis' | 'submittals', id: string, patch: Record<string, unknown>) => {
    const key = `${table}:${id}`;
    const seq = (proDocEditSeqRef.current.get(key) ?? 0) + 1;
    proDocEditSeqRef.current.set(key, seq);
    void trackedWrite(proDocWriteTouchRef, table, 'update', patch).then((outcome) => {
      if (outcome === 'synced') void adoptProDocStamp(table, id, seq);
    });
  }, [adoptProDocStamp]);

  const updateRFI = useCallback((id: string, updates: Partial<RFI>) => {
    // The ref, not the render's `rfis` (rfi-core 2e): an update after a long
    // await (the email send) must not rebuild the list from the tap-time copy.
    const base = rfisRef.current;
    const before = base.find(x => x.id === id);
    if (!before) return;
    // #55 · ONLY the columns this edit changed, never the whole row: the whole
    // row from a phone holding the 7am copy wrote response NULL and status
    // 'open' over the architect's 10am portal answer. Values from
    // rfiMutableRow (one shape with the insert); portal_state never here
    // (sendToClientPortal owns it). Review round 1: updated_at is the SERVER's
    // stamp for this copy when known (the guard then steps aside — he saw the
    // current row, so a deliberate reopen lands), else the device clock (the
    // guard refuses any regression). A regression with no known server stamp
    // is refused here, with why — never sent to be silently undone
    // (planProDocEdit has the whole rule).
    const plan = planProDocEdit({ kind: 'rfi', before, updates, nowIso: new Date().toISOString(), sending: canSync });
    if (!plan.ok) { showAlert(plan.title, plan.reason); return; }
    const updated = base.map(r => (r.id === id ? plan.next : r));
    rfisRef.current = updated;
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) {
      const patch = rowPatch(rfiMutableRow(plan.next), plan.changedKeys, RFI_FIELD_COLUMNS, plan.stamp);
      if (Object.keys(patch).length > 2) sendProDocPatch('rfis', id, patch);
    }
  }, [saveRfisMutation, canSync, rfiMutableRow, sendProDocPatch]);

  // #23/#24 (wave 4): the ref, not the render's `rfis` — a delete right
  // after an add in the same flow rebuilt the list without the new row. The
  // write goes through the ordered writer (a queued INSERT or edit of this RFI
  // is replayed first, then the delete) and is touched, so a list read that
  // is out meanwhile does not bring the row back.
  const deleteRFI = useCallback((id: string) => {
    const updated = rfisRef.current.filter(r => r.id !== id);
    rfisRef.current = updated;
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('rfis', 'delete', { id }));
  }, [saveRfisMutation, canSync]);

  const getRFIsForProject = useCallback((projectId: string) => rfis.filter(r => r.projectId === projectId).sort((a, b) => b.number - a.number), [rfis]);

  const permitToRow = useCallback((p: Permit) => ({
    id: p.id,
    user_id: userId,
    project_id: p.projectId,
    project_name: p.projectName ?? null,
    type: p.type,
    permit_number: p.permitNumber ?? null,
    jurisdiction: p.jurisdiction ?? '',
    status: p.status,
    applied_date: p.appliedDate || null,
    approved_date: p.approvedDate || null,
    expires_date: p.expiresDate || null,
    inspection_date: p.inspectionDate || null,
    inspection_notes: p.inspectionNotes ?? null,
    fee: p.fee ?? 0,
    notes: p.notes ?? null,
    phase: p.phase ?? null,
    attachment_uri: p.attachmentUri ?? null,
    special_inspection_category: p.specialInspectionCategory ?? null,
    inspector_name: p.inspectorName ?? null,
    last_report_summary: p.lastReportSummary ?? null,
    last_report_date: p.lastReportDate || null,
    created_at: p.createdAt ?? new Date().toISOString(),
    updated_at: p.updatedAt ?? new Date().toISOString(),
  }), [userId]);

  const addPermit = useCallback((permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newPermit: Permit = { ...permit, id: generateUUID(), createdAt: now, updatedAt: now };
    const updated = [newPermit, ...permits];
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    if (canSync && userId) void touchedWrite(proDocWriteTouchRef, newPermit.id, () => supabaseWrite('permits', 'insert', permitToRow(newPermit)));
    return newPermit;
  }, [permits, savePermitsMutation, canSync, userId, permitToRow]);

  const updatePermit = useCallback((id: string, updates: Partial<Permit>) => {
    const now = new Date().toISOString();
    const updated = permits.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p);
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    const next = updated.find(p => p.id === id);
    if (canSync && userId && next) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('permits', 'update', permitToRow(next)));
  }, [permits, savePermitsMutation, canSync, userId, permitToRow]);

  const deletePermit = useCallback((id: string) => {
    const updated = permits.filter(p => p.id !== id);
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('permits', 'delete', { id }));
  }, [permits, savePermitsMutation, canSync]);

  const getPermitsForProject = useCallback((projectId: string) =>
    permits.filter(p => p.projectId === projectId).sort((a, b) => new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime()),
    [permits]);

  // AIA pay applications. addAIAPayApp accepts a preassembled SavedAIAPayApp
  // (built from the editing screen with computed totals) so the helper stays
  // simple — no SOV math here, just persistence + de-dupe by (projectId,
  // applicationNumber).
  const aiaPayAppToRow = useCallback((a: SavedAIAPayApp) => ({
    // MONEY-F1: data columns come from the round-trip-tested pure writer —
    // `snapshot_totals: a.totals`. The old `a.snapshotTotals` never existed, so
    // every saved pay app wrote NULL and lost its totals on the next launch.
    // The pay-link columns are deliberately NOT written from here — see
    // savedToAiaRow's own comment for why that is now a correctness choice
    // rather than a pending migration.
    ...savedToAiaRow(a, userId),
    // Spread, not `?? null`. PostgREST writes only the keys present in the
    // payload, so omitting an undefined portalState PRESERVES the server value.
    // Writing null actively destroyed it: before the read mappers were fixed, a
    // refetch blanked portalState in memory and the very next edit persisted
    // that blank — turning a display bug into permanent data loss.
    ...(a.portalState !== undefined ? { portal_state: a.portalState } : {}),
  }), [userId]);

  const addAIAPayApp = useCallback((app: SavedAIAPayApp) => {
    const finalApp: SavedAIAPayApp = {
      ...app,
      portalState: app.portalState ?? initialPortalState('aia_pay_app', app.projectId),
    };
    // DE-DUPE ON WHAT THE RECORD *IS*, NOT ON A NUMBER DERIVED FROM IT.
    //
    // This used to key on (projectId, applicationNumber) — which agreed with
    // the screen's own identity only until app/aia-pay-app.tsx moved that
    // identity onto `invoiceId` (so a reopen updates the certificate it
    // reopened) and, in the same change, made APPLICATION NO. a field the GC
    // is actively invited to edit. The two keys then disagreed: typing a
    // number another saved pay app already held DELETED that record from local
    // state while the new one kept its own id, and since the write is an
    // upsert of the NEW id nothing removed the other row on the server — so it
    // came back on the next refetch as a duplicate application number, and
    // (getAIAPayAppsForProject sorting applicationNumber DESC) could become
    // payApps[0], the WIP report's contract baseline.
    //
    // `id` first: a re-save of a record we already hold is the same record.
    // `invoiceId` next: one billing period is one certificate. applicationNumber
    // remains ONLY for legacy rows that predate invoiceId, so a record written
    // before the screen was invoice-keyed still replaces itself rather than
    // doubling.
    const sameRecord = (a: SavedAIAPayApp) => {
      if (a.projectId !== finalApp.projectId) return false;
      if (a.id === finalApp.id) return true;
      if (finalApp.invoiceId && a.invoiceId) return a.invoiceId === finalApp.invoiceId;
      if (!a.invoiceId && !finalApp.invoiceId) return a.applicationNumber === finalApp.applicationNumber;
      return false;
    };
    const dedup = aiaPayApps.filter(a => !sameRecord(a));
    const updated = [finalApp, ...dedup];
    setAiaPayApps(updated);
    saveAiaPayAppsMutation.mutate(updated);
    // A DISPLACED RECORD MUST LEAVE THE SERVER TOO. The legacy branch above can
    // drop a row whose id is NOT finalApp.id (a pre-invoiceId record at the
    // same application number). Dropping it only from local state left it on
    // aia_pay_apps, where the next server-first load brought it back as a
    // second certificate for one period — the duplicate this de-dupe exists to
    // prevent, reintroduced by the de-dupe itself.
    const displaced = aiaPayApps.filter(a => sameRecord(a) && a.id !== finalApp.id);
    if (canSync && userId) {
      displaced.forEach(a => { void touchedWrite(proDocWriteTouchRef, a.id, () => supabaseWrite('aia_pay_apps', 'delete', { id: a.id })); });
    }
    // UPSERT, not insert.
    //
    // The old comment here said the screen "always saves as new ID per draft so
    // insert is correct", and accepted that a re-save of the same id returns a
    // 409 "we ignore". Neither half held. buildSavedRecord reuses the existing
    // record's id precisely so a re-save UPDATES the certificate, so the second
    // save of any pay application WAS that case. utils/offlineQueue's own
    // 'upsert' branch spells the consequence out: "a plain insert on an
    // existing PK fails with a duplicate-key violation … so the edit would
    // silently never reach the server (and the server-first load would then
    // revert it locally)." Both of the queue's insert paths agree — the direct
    // write drops it as a non-network failure, and a queued re-send reads a
    // `_pkey` 23505 as "already landed" (isAlreadyLandedInsert) and discards
    // it as SUCCESS. So the corrected certificate lived on one device only,
    // and the next server-first load reverted it there too.
    //
    // Not literally silent, and the difference matters when reading a bug
    // report: the direct path does raise a generic "Couldn't save
    // (aia_pay_apps)" toast and a Sentry event. What it cannot do is tell the
    // GC that the figure he just corrected on a signed certificate is not the
    // figure the portal is showing his owner.
    //
    // Upsert is the correct semantic for a row this user owns and is editing.
    // It cannot clobber someone else's row — aia_pay_apps is user-scoped by RLS
    // (policy aia_pay_apps_owner_all, migration 20260518120000) — and the
    // DB-level freeze trigger (migration 20260728120000) still rejects any
    // update to a CERTIFIED application's financial columns (raising
    // check_violation, which the queue classifies non-transient and therefore
    // does NOT retry forever), so this widens the write path without widening
    // what may be rewritten. addAIAPayApp is the only upsert writer of this
    // table; the portal send/recall path writes portal_state through 'update',
    // which the trigger permits by design.
    // #5 (wave 4): touched, so the foreground pass's aiaPayApps re-read (or
    // any other) that goes out while this upsert is on the wire keeps the
    // device copy — a first pay app no longer vanishes, and a corrected one
    // no longer reverts to the server's pre-edit figures.
    if (canSync && userId) void touchedWrite(proDocWriteTouchRef, finalApp.id, () => supabaseWrite('aia_pay_apps', 'upsert', aiaPayAppToRow(finalApp)));
    return finalApp;
  }, [aiaPayApps, saveAiaPayAppsMutation, canSync, userId, aiaPayAppToRow, initialPortalState]);

  const deleteAIAPayApp = useCallback((id: string) => {
    const updated = aiaPayApps.filter(a => a.id !== id);
    setAiaPayApps(updated);
    saveAiaPayAppsMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('aia_pay_apps', 'delete', { id }));
  }, [aiaPayApps, saveAiaPayAppsMutation, canSync]);

  const getAIAPayAppsForProject = useCallback((projectId: string) =>
    aiaPayApps.filter(a => a.projectId === projectId).sort((a, b) => b.applicationNumber - a.applicationNumber),
    [aiaPayApps]);

  // Sub portal links. Each (project, sub) pair gets one link. upsert keeps
  // a stable id so the share URL doesn't change when the GC tweaks settings.
  const upsertSubPortalLink = useCallback((link: SubPortalLink) => {
    // The sub-portal RPCs (sub_portal_get_snapshot / sub_portal_submit_invoice)
    // require `access_token = p_access_token`, so the token the app shares must
    // be the one the server holds. The token is the SERVER's to mint: the
    // column is NOT NULL with a random default, so a row written without it
    // gets one, and app/sub-portal-setup.tsx reads it back and adopts it.
    //
    // This used to mint a token here whenever local state had none and write
    // it with a plain INSERT. Local state had none after every server load (the
    // mapper dropped the column), and the insert of an existing id fails as a
    // duplicate — which the queue treats as "already landed". So the phone
    // shared a token the server never saw, AND no edit after the first save
    // (disabling the link, a new passcode) ever reached the server.
    //
    // Now an UPSERT on the id, so edits land; `access_token` only when we hold
    // the server's own value, so the update never touches the column otherwise
    // (PostgREST updates only the columns it is sent).
    const filtered = subPortalLinks.filter(l => l.id !== link.id);
    const updated = [link, ...filtered];
    setSubPortalLinks(updated);
    saveSubPortalLinksMutation.mutate(updated);
    if (canSync && userId) {
      void supabaseWrite('sub_portal_links', 'upsert', {
        id: link.id,
        user_id: userId,
        project_id: link.projectId,
        subcontractor_id: link.subcontractorId,
        passcode: link.passcode ?? null,
        require_passcode: !!link.requirePasscode,
        enabled: link.enabled,
        welcome_message: link.welcomeMessage ?? null,
        ...(link.accessToken ? { access_token: link.accessToken } : {}),
        commitment_ids: link.commitmentIds ?? null,
        created_at: link.createdAt,
        updated_at: link.updatedAt,
        last_shared_at: link.lastSharedAt ?? null,
      });
    }
    return link;
  }, [subPortalLinks, saveSubPortalLinksMutation, canSync, userId]);

  const adoptSubPortalToken = useCallback((id: string, accessToken: string) => {
    setSubPortalLinks(prev => {
      const next = prev.map(l => (l.id === id && l.accessToken !== accessToken ? { ...l, accessToken } : l));
      saveSubPortalLinksMutation.mutate(next);
      return next;
    });
  }, [saveSubPortalLinksMutation]);

  const deleteSubPortalLink = useCallback((id: string) => {
    const updated = subPortalLinks.filter(l => l.id !== id);
    setSubPortalLinks(updated);
    saveSubPortalLinksMutation.mutate(updated);
    if (canSync) void supabaseWrite('sub_portal_links', 'delete', { id });
  }, [subPortalLinks, saveSubPortalLinksMutation, canSync]);

  const getSubPortalLinkFor = useCallback((projectId: string, subcontractorId: string) =>
    subPortalLinks.find(l => l.projectId === projectId && l.subcontractorId === subcontractorId),
    [subPortalLinks]);

  const getSubPortalLinksForProject = useCallback((projectId: string) =>
    subPortalLinks.filter(l => l.projectId === projectId).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [subPortalLinks]);

  // Snake/camel mapping for the submittals row — every column an EDIT may
  // change. Shared by insert (via buildSubmittal) and update so the two cannot
  // drift, matching the commitmentToRow / permitToRow pattern above.
  //
  // WHY THIS EXISTS. updateSubmittal used to write only
  // { id, title, spec_section, review_cycles, current_status, attachments,
  // updated_at } — it dropped submitted_by and required_date, both real columns
  // written on INSERT and read back by the submittals mapper before
  // saveLocal(SUBMITTALS_KEY, mapped). A GC who extended a submittal's review
  // window watched the date silently revert on the next launch, and
  // requiredDate drives systemOfAction's awaiting-review chase list and its
  // auto-drafted nudge ("awaiting review for N days past the required date") —
  // so the reviewer kept being chased against a deadline that had moved, and
  // the transmittal PDF printed the stale Required By.
  const submittalMutableRow = useCallback((s: Submittal) => ({
    id: s.id, title: s.title, spec_section: s.specSection, submitted_by: s.submittedBy,
    submitted_date: s.submittedDate, required_date: s.requiredDate,
    review_cycles: s.reviewCycles, current_status: s.currentStatus,
    attachments: s.attachments, updated_at: s.updatedAt,
    // #60 / #144: the intake columns (20260919090000) — the linked task, the
    // spec-book type/trade/pages, the AI lead and where the required date came
    // from. `?? null` inside, so clearing the link reaches the server.
    ...submittalIntakeColumns(s),
  }), []);

  // Build one Submittal off the current list, assigning the next per-project
  // number. Reads `base` (the authoritative current array) so callers looping
  // synchronously can thread the just-updated array through each iteration.
  const buildSubmittal = useCallback((
    sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>,
    base: Submittal[],
  ): { newSub: Submittal; row: Record<string, unknown> } => {
    const projectSubs = base.filter(s => s.projectId === sub.projectId);
    const nextNumber = projectSubs.length > 0 ? Math.max(...projectSubs.map(s => s.number)) + 1 : 1;
    const now = new Date().toISOString();
    const newSub: Submittal = {
      ...sub,
      id: generateUUID(),
      number: nextNumber,
      createdAt: now,
      updatedAt: now,
      portalState: sub.portalState ?? initialPortalState('submittal', sub.projectId),
      // #30: the reply-link token from birth, as addRFI.
      shareToken: mintShareToken(),
    };
    const row = {
      ...submittalMutableRow(newSub),
      user_id: userId, project_id: newSub.projectId, number: newSub.number,
      created_at: now, portal_state: newSub.portalState,
      // INSERT only — submittalMutableRow never names it, so no edit nulls it.
      ...(newSub.shareToken ? { share_token: newSub.shareToken } : {}),
    };
    return { newSub, row };
  }, [userId, initialPortalState, submittalMutableRow]);

  const addSubmittal = useCallback((sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => {
    // Read the ref (not `submittals`) so numbering stays correct when this is
    // called N times in one synchronous loop before React re-renders.
    const base = submittalsRef.current;
    const { newSub, row } = buildSubmittal(sub, base);
    const updated = [newSub, ...base];
    submittalsRef.current = updated;
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, String(row.id ?? ''), () => supabaseWrite('submittals', 'insert', row));
  }, [buildSubmittal, saveSubmittalsMutation, canSync]);

  // Batch insert — assigns sequential per-project numbers to every row and
  // commits in ONE setState. Use this from bulk flows (e.g. extract-submittals)
  // instead of looping addSubmittal, so the review count matches what persists.
  const addSubmittals = useCallback((subs: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>[]) => {
    if (subs.length === 0) return;
    let working = submittalsRef.current;
    const rows: Record<string, unknown>[] = [];
    for (const sub of subs) {
      const { newSub, row } = buildSubmittal(sub, working);
      working = [newSub, ...working];
      rows.push(row);
    }
    submittalsRef.current = working;
    setSubmittals(working);
    saveSubmittalsMutation.mutate(working);
    if (canSync) sendNumberedInsertsInOrder('submittals', rows);
  }, [buildSubmittal, saveSubmittalsMutation, canSync, sendNumberedInsertsInOrder]);

  const updateSubmittal = useCallback((id: string, updates: Partial<Submittal>) => {
    const base = submittalsRef.current;
    const before = base.find(x => x.id === id);
    if (!before) return;
    // #55 · Only the changed columns (see updateRFI): a title edit from a
    // stale copy used to rewrite review_cycles and current_status and erase
    // the architect's 'Approved as Noted'. Values from submittalMutableRow;
    // portal_state never here. The stamp rule is updateRFI's.
    const plan = planProDocEdit({ kind: 'submittal', before, updates, nowIso: new Date().toISOString(), sending: canSync });
    if (!plan.ok) { showAlert(plan.title, plan.reason); return; }
    const updated = base.map(s => (s.id === id ? plan.next : s));
    submittalsRef.current = updated;
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) {
      const patch = rowPatch(submittalMutableRow(plan.next), plan.changedKeys, SUBMITTAL_FIELD_COLUMNS, plan.stamp);
      if (Object.keys(patch).length > 2) sendProDocPatch('submittals', id, patch);
    }
  }, [saveSubmittalsMutation, canSync, submittalMutableRow, sendProDocPatch]);

  // #23/#24 (wave 4): the ref and the ordered, touched write — see deleteRFI.
  const deleteSubmittal = useCallback((id: string) => {
    const updated = submittalsRef.current.filter(s => s.id !== id);
    submittalsRef.current = updated;
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('submittals', 'delete', { id }));
  }, [saveSubmittalsMutation, canSync]);

  const getSubmittalsForProject = useCallback((projectId: string) => submittals.filter(s => s.projectId === projectId).sort((a, b) => b.number - a.number), [submittals]);

  // #55 (c) · A review cycle is APPENDED on the server
  // (submittal_append_review_cycle, 20260919080000 §7): numbered there under a
  // row lock, so two devices never both write 'Cycle 2', and a cycle the
  // architect's portal closed is never rewritten from this device's copy.
  // Shown at once with a provisional number; the server's number replaces it.
  // OFFLINE (the call never reached the server, or the submittal's own insert
  // is still queued so the RPC could not find it): the cycle goes through the
  // offline queue as a patch of review_cycles + current_status. That is safe
  // only because the same migration's guard makes review_cycles append-only on
  // every write — each server cycle is kept as the server has it, and the one
  // this device added is appended and renumbered after the server's highest.
  // A close-in-place (closesOpenCycle) cannot ride that path — the guard keeps
  // the server's open cycle as it is — so offline it is refused, with why.
  // A refusal from the server takes the provisional cycle back off the screen
  // and tells him.
  const addReviewCycle = useCallback(async (
    submittalId: string,
    cycle: Omit<SubmittalReviewCycle, 'cycleNumber'> & { closesOpenCycle?: boolean },
  ): Promise<ReviewCycleResult> => {
    const sub = submittalsRef.current.find(s => s.id === submittalId);
    if (!sub) return { ok: false, reason: 'That submittal is no longer on this device.' };
    const { closesOpenCycle, ...cycleFields } = cycle;
    const openIdx = sub.reviewCycles.length - 1;
    const closesInPlace = !!closesOpenCycle && openIdx >= 0
      && sub.reviewCycles[openIdx].status === 'in_review' && !sub.reviewCycles[openIdx].returnDate;
    const provisionalNo = closesInPlace
      ? sub.reviewCycles[openIdx].cycleNumber
      : Math.max(0, ...sub.reviewCycles.map(c => Number(c.cycleNumber) || 0)) + 1;
    const provisional: SubmittalReviewCycle = closesInPlace
      ? { ...sub.reviewCycles[openIdx], ...cycleFields, sentDate: sub.reviewCycles[openIdx].sentDate, cycleNumber: provisionalNo }
      : { ...cycleFields, cycleNumber: provisionalNo };
    const withCycle = (s: Submittal, c: SubmittalReviewCycle): Submittal => ({
      ...s,
      reviewCycles: closesInPlace ? s.reviewCycles.map((x, i) => (i === openIdx ? c : x)) : [...s.reviewCycles, c],
      currentStatus: c.status,
      updatedAt: new Date().toISOString(),
      // The append moves the server's updated_at; the re-read after it (or
      // after the queued patch flushes) brings the new stamp.
      serverUpdatedAt: undefined,
    });
    const applyLocal = (next: (s: Submittal) => Submittal) => {
      const list = submittalsRef.current.map(s => (s.id === submittalId ? next(s) : s));
      submittalsRef.current = list;
      setSubmittals(list);
      saveSubmittalsMutation.mutate(list);
    };
    applyLocal(s => withCycle(s, provisional));
    if (!canSync) return { ok: true, cycleNumber: provisionalNo };

    const revert = (reason: string): ReviewCycleResult => {
      applyLocal(s => ({ ...s, reviewCycles: sub.reviewCycles, currentStatus: sub.currentStatus }));
      showAlert('Review cycle not saved', reason);
      return { ok: false, reason };
    };
    // #23 (wave 4): `enqueue` when the submittal's own INSERT (or an earlier
    // cycle patch — #29) is still queued — the patch is appended to the queue
    // itself, behind it. Sent
    // "directly" it matched 0 rows and PostgREST called it success, so the
    // cycle vanished once the INSERT landed. From a network failure the
    // ordinary write path queues it (and orders it behind anything queued).
    const viaQueue = (enqueue = false, hold: 'insert' | 'cycle_patch' | 'network' = 'network'): ReviewCycleResult => {
      if (closesInPlace) {
        // #29: the reason that is TRUE — an unsynced submittal, a cycle change
        // still syncing, or no connection — never "needs a connection" with
        // full signal.
        return revert(closeCycleHoldReason(hold, provisionalNo));
      }
      const now = new Date().toISOString();
      const current = submittalsRef.current.find(s => s.id === submittalId);
      if (current) {
        const cyclePatch = rowPatch(submittalMutableRow(current), ['reviewCycles', 'currentStatus'], SUBMITTAL_FIELD_COLUMNS, now);
        if (enqueue) void addToOfflineQueue({ table: 'submittals', operation: 'update', data: cyclePatch }).catch(() => { /* addToOfflineQueue reports the drop */ });
        else void touchedWrite(proDocWriteTouchRef, submittalId, () => supabaseWrite('submittals', 'update', cyclePatch));
      }
      return { ok: true, cycleNumber: provisionalNo, queued: true };
    };

    // #29 · Through the queue only when the submittal's INSERT is still
    // queued (the RPC cannot find the row) or a queued update carries
    // review_cycles / current_status (it would land after the RPC and
    // overwrite it) — submittalCycleQueueHold. A queued edit of any other
    // column (a title typo) no longer holds the cycle: it is a named-column
    // patch that cannot touch the log. An unreadable queue counts as holding
    // the INSERT (as punch does): queuing the patch is never wrong, a 0-row
    // "success" is.
    let hold: 'insert' | 'cycle_patch' | null = 'insert';
    try { hold = submittalCycleQueueHold(await getOfflineQueue(), submittalId); } catch { /* keep 'insert' */ }
    if (hold) return viaQueue(true, hold);

    try {
      const { data, error } = await supabase.rpc('submittal_append_review_cycle', {
        p_submittal_id: submittalId,
        p_cycle: { ...cycleFields, ...(closesInPlace ? { closesOpenCycle: true } : {}) },
      });
      if (error) {
        if (looksLikeNetworkFailure(error.message)) return viaQueue();
        return revert(`The server refused it: ${error.message}`);
      }
      const res = (data ?? {}) as { success?: boolean; cycle_number?: number; error?: string; status?: string };
      if (res.success === false && res.error === 'already_closed') {
        // #27 (CONTRACT 16): the reviewer already returned this cycle through
        // the reply link; nothing was added and the status was left alone.
        // revert() alone would put the stale copy (the cycle still open) back
        // on screen — re-read so the reviewer's stamp shows.
        const out = revert(alreadyClosedCycleReason(res, provisionalNo));
        void queryClient.invalidateQueries({ queryKey: ['submittals', userId] });
        return out;
      }
      if (!res.success || typeof res.cycle_number !== 'number') {
        const why = res.error === 'not_found' ? 'this submittal is not on the server (it may have been deleted)'
          : res.error === 'reviewer_required' ? 'a reviewer is required'
            : res.error === 'invalid_status' ? 'that status is not one the server accepts'
              : (res.error ?? 'no reason given');
        return revert(`The server did not add it: ${why}.`);
      }
      const serverNo = res.cycle_number;
      applyLocal(s => ({
        ...s,
        reviewCycles: s.reviewCycles.map(c => (c === provisional || (c.cycleNumber === provisionalNo && c.sentDate === provisional.sentDate)
          ? { ...c, cycleNumber: serverNo } : c)),
      }));
      // The server's row is the truth now (its number, and any cycle the
      // portal wrote meanwhile).
      void queryClient.invalidateQueries({ queryKey: ['submittals', userId] });
      return { ok: true, cycleNumber: serverNo };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (looksLikeNetworkFailure(msg)) return viaQueue();
      return revert(`It could not be sent: ${msg}`);
    }
  }, [canSync, saveSubmittalsMutation, submittalMutableRow, queryClient, userId]);

  // ─── OAC Meetings (server-synced) ──────────────────────────────
  // Snake/camel mapping helper for the supabase write payload — keeps
  // the inline write calls compact and easy to read.
  const oacMeetingToRow = useCallback((m: OACMeeting) => ({
    id: m.id, user_id: userId, project_id: m.projectId, number: m.number,
    scheduled_at: m.scheduledAt, duration_minutes: m.durationMinutes,
    location: m.location,
    attendees: m.attendees as unknown,
    agenda: m.agenda as unknown,
    action_items: m.actionItems as unknown,
    transcript: m.transcript, minutes: m.minutes, status: m.status,
    distributed_at: m.distributedAt,
    distribution_log: m.distributionLog as unknown,
    created_at: m.createdAt, updated_at: m.updatedAt,
  }), [userId]);

  const addOACMeeting = useCallback((meeting: OACMeeting) => {
    const updated = [...oacMeetings, meeting];
    setOacMeetings(updated);
    saveOACMeetingsMutation.mutate(updated);
    if (canSync) void supabaseWrite('oac_meetings', 'insert', oacMeetingToRow(meeting));
  }, [oacMeetings, saveOACMeetingsMutation, canSync, oacMeetingToRow]);

  const updateOACMeeting = useCallback((id: string, patch: Partial<OACMeeting>) => {
    const updated = oacMeetings.map(m => m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m);
    setOacMeetings(updated);
    saveOACMeetingsMutation.mutate(updated);
    const merged = updated.find(m => m.id === id);
    if (merged && canSync) {
      void supabaseWrite('oac_meetings', 'update', oacMeetingToRow(merged));
    }
  }, [oacMeetings, saveOACMeetingsMutation, canSync, oacMeetingToRow]);

  const deleteOACMeeting = useCallback((id: string) => {
    const updated = oacMeetings.filter(m => m.id !== id);
    setOacMeetings(updated);
    saveOACMeetingsMutation.mutate(updated);
    if (canSync) void supabaseWrite('oac_meetings', 'delete', { id });
  }, [oacMeetings, saveOACMeetingsMutation, canSync]);

  const getOACMeetingsForProject = useCallback(
    (projectId: string) => oacMeetings.filter(m => m.projectId === projectId).sort((a, b) => b.number - a.number),
    [oacMeetings],
  );

  // ─── COI vault (server-synced) ─────────────────────────────────
  const coiToRow = useCallback((c: CertificateOfInsurance) => ({
    id: c.id, user_id: userId,
    subcontractor_id: c.subcontractorId,
    project_id: c.projectId,
    file_uri: c.fileUri,
    uploaded_at: c.uploadedAt,
    validation: c.validation as unknown,
    coverages: (c.coverages ?? []) as unknown,
    notes: c.notes,
  }), [userId]);

  // PRODUCT-F1: the vault never told the subcontractor record when its
  // certificate expires, so coi-expiry-watch (which reads
  // subcontractors.coi_expiry) and the Subs tab compliance badge never saw a
  // vaulted cert. The sub's coiExpiry is the LATEST expiry across every
  // certificate on file for them (each cert counting from its earliest
  // coverage), recomputed on add, edit and delete — stamping the one cert
  // being edited regressed the sub to an older certificate. `verified` stamps
  // coiVerifiedAt (a cert was uploaded or edited, so it was looked at); a
  // delete only moves the date. No usable date anywhere → nothing changes.
  // coi-subs (wave 5): `verified` stamps only when the saved certificate has
  // no coverage that is still an unconfirmed AI read (coiSaveStampsVerified)
  // — the date still moves, since it reads expiresAt only.
  const syncSubCoiExpiry = useCallback((subcontractorId: string | undefined, all: CertificateOfInsurance[], verified: boolean) => {
    if (!subcontractorId) return;
    const latest = subCoiExpiryAcross(all.filter(c => c.subcontractorId === subcontractorId));
    if (!latest) return;
    if (!verified && subcontractors.find(s => s.id === subcontractorId)?.coiExpiry === latest) return;
    updateSubcontractor(subcontractorId, verified
      ? { coiExpiry: latest, coiVerifiedAt: new Date().toISOString() }
      : { coiExpiry: latest });
  }, [updateSubcontractor, subcontractors]);

  const addCOI = useCallback((coi: CertificateOfInsurance) => {
    const updated = [...cois, coi];
    setCois(updated);
    saveCOIsMutation.mutate(updated);
    if (canSync) void supabaseWrite('cois', 'insert', coiToRow(coi));
    syncSubCoiExpiry(coi.subcontractorId, updated, coiSaveStampsVerified(coi));
  }, [cois, saveCOIsMutation, canSync, coiToRow, syncSubCoiExpiry]);

  const updateCOI = useCallback((id: string, patch: Partial<CertificateOfInsurance>) => {
    const prior = cois.find(c => c.id === id);
    const updated = cois.map(c => c.id === id ? { ...c, ...patch } : c);
    setCois(updated);
    saveCOIsMutation.mutate(updated);
    const merged = updated.find(c => c.id === id);
    if (merged && canSync) {
      void supabaseWrite('cois', 'update', coiToRow(merged));
    }
    if (merged) {
      syncSubCoiExpiry(merged.subcontractorId, updated, coiSaveStampsVerified(merged));
      // Re-filed under another sub: the previous sub loses this cert too.
      if (prior && prior.subcontractorId !== merged.subcontractorId) syncSubCoiExpiry(prior.subcontractorId, updated, false);
    }
  }, [cois, saveCOIsMutation, canSync, coiToRow, syncSubCoiExpiry]);

  const deleteCOI = useCallback((id: string) => {
    const removed = cois.find(c => c.id === id);
    const updated = cois.filter(c => c.id !== id);
    setCois(updated);
    saveCOIsMutation.mutate(updated);
    if (canSync) void supabaseWrite('cois', 'delete', { id });
    syncSubCoiExpiry(removed?.subcontractorId, updated, false);
  }, [cois, saveCOIsMutation, canSync, syncSubCoiExpiry]);

  const getCOIsForSub = useCallback(
    (subId: string) => cois.filter(c => c.subcontractorId === subId),
    [cois],
  );

  const addEquipment = useCallback((equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString();
    const newEquip: Equipment = { ...equip, id: generateUUID(), createdAt: now };
    const updated = [newEquip, ...equipment];
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('equipment', 'insert', {
        id: newEquip.id, user_id: userId, name: newEquip.name, type: newEquip.type,
        category: newEquip.category, make: newEquip.make, model: newEquip.model, year: newEquip.year,
        serial_number: newEquip.serialNumber, daily_rate: newEquip.dailyRate,
        current_project_id: newEquip.currentProjectId, maintenance_schedule: newEquip.maintenanceSchedule,
        utilization_log: newEquip.utilizationLog, status: newEquip.status, notes: newEquip.notes, created_at: now,
      });
    }
  }, [equipment, saveEquipmentMutation, canSync, userId]);

  const updateEquipment = useCallback((id: string, updates: Partial<Equipment>) => {
    const updated = equipment.map(e => e.id === id ? { ...e, ...updates } : e);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      const e = updated.find(x => x.id === id);
      if (e) {
        void supabaseWrite('equipment', 'update', {
          id, name: e.name, type: e.type, category: e.category, make: e.make, model: e.model,
          daily_rate: e.dailyRate, current_project_id: e.currentProjectId,
          maintenance_schedule: e.maintenanceSchedule, utilization_log: e.utilizationLog,
          status: e.status, notes: e.notes,
        });
      }
    }
  }, [equipment, saveEquipmentMutation, canSync]);

  const deleteEquipment = useCallback((id: string) => {
    const updated = equipment.filter(e => e.id !== id);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) void supabaseWrite('equipment', 'delete', { id });
  }, [equipment, saveEquipmentMutation, canSync]);

  const logUtilization = useCallback((entry: Omit<EquipmentUtilizationEntry, 'id'>) => {
    const newEntry: EquipmentUtilizationEntry = { ...entry, id: generateUUID() };
    const updated = equipment.map(e => e.id === entry.equipmentId ? { ...e, utilizationLog: [...e.utilizationLog, newEntry] } : e);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      const e = updated.find(x => x.id === entry.equipmentId);
      if (e) {
        void supabaseWrite('equipment', 'update', { id: e.id, utilization_log: e.utilizationLog });
      }
    }
  }, [equipment, saveEquipmentMutation, canSync]);

  const getEquipmentForProject = useCallback((projectId: string) => equipment.filter(e => e.currentProjectId === projectId), [equipment]);

  const getEquipmentCostForProject = useCallback((projectId: string) => {
    return equipment
      .filter(e => e.currentProjectId === projectId)
      .reduce((sum, e) => {
        const daysUsed = e.utilizationLog.filter(u => u.projectId === projectId).length;
        return sum + (e.dailyRate * Math.max(daysUsed, 1));
      }, 0);
  }, [equipment]);

  // Warranties — cloud-backed as of t1.1 audit-fix migration. Same
  // try-cloud-then-local fallback as commitments / permits.
  // #23 round 2: not a react-query key, so the foreground pass and the
  // user's Retry reach it through warrantiesReload — before, it was read once
  // per launch, and after a failed read its portal stamp never came back.
  useEffect(() => {
    let cancelled = false;
    const readEpoch = portalReadEpochRef.current; // #23: the epoch this read STARTED in
    (async () => {
      if (canSync) {
        try {
          const bearerBefore = await readBearer();
          const readStartedAt = Date.now();
          const { data, error } = await supabase.from('warranties').select('*').order('end_date', { ascending: true });
          // #23: a zero-row answer to his live bearer is the server's answer
          // too — see the permits loader.
          if (!error && data && (data.length > 0 || await emptyReadTrusted(userId, bearerBefore))) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              projectName: (r.project_name as string | null) ?? '',
              title: (r.title as string) ?? '',
              category: r.category as Warranty['category'],
              description: (r.description as string | null) ?? undefined,
              provider: (r.provider as string) ?? '',
              providerContactId: (r.provider_contact_id as string | null) ?? undefined,
              startDate: (r.start_date as string | null) ?? '',
              durationMonths: Number(r.duration_months) || 12,
              endDate: (r.end_date as string | null) ?? '',
              coverageDetails: (r.coverage_details as string | null) ?? undefined,
              exclusions: (r.exclusions as string | null) ?? undefined,
              documentUri: (r.document_uri as string | null) ?? undefined,
              status: r.status as Warranty['status'],
              claims: (r.claims as Warranty['claims']) ?? [],
              reminderDays: r.reminder_days == null ? undefined : Number(r.reminder_days),
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // portal_state MUST be read back. It is written on insert and on every
              // send/recall, but was hydrated ONLY by the invoices mapper — so a refetch
              // stripped it here, saveLocal destroyed the local copy, and
              // portalSnapshot.isShared() treats undefined as SENT (grandfathering
              // pre-portal records). Net effect: unsent DRAFTS and explicitly RECALLED
              // items became client-visible on the next project open.
              portalState: (r.portal_state as PortalState | null) ?? undefined,
            })) as Warranty[];
            // Queued and in-flight device rows are kept with rows too (see permits).
            const priorWarranties = await loadLocal<Warranty[]>(WARRANTIES_KEY, []);
            const touchedWr = deviceRowsWrittenDuringRead(proDocWriteTouchRef.current, readStartedAt, priorWarranties);
            const next = mergeLocalOnly(mapped, priorWarranties, new Set([...await queuedIdsFor('warranties'), ...await unsavedWriteIds('warranties'), ...touchedWr.keep]), { deletedIds: new Set([...await queuedDeletesFor('warranties'), ...touchedWr.gone]) });
            // #6 (wave 4): `cancelled` flips when userId changes; the live-account
            // check also covers a sign-out whose render has not run yet.
            if (!cancelled && liveUserIdRef.current === userId) {
              portalWarrantyBaseRef.current = next; // a read, not a local write (#23)
              setWarranties(next);
              setWarrantiesLoadedFor(userId ?? '');
              notePortalRead('warranties', userId, true, readEpoch); // #23: the server's list
              await saveLocal(WARRANTIES_KEY, next);
              return;
            }
          }
        } catch { /* fallback */ }
      }
      const local = await loadLocal<Warranty[]>(WARRANTIES_KEY, []);
      if (!cancelled) {
        portalWarrantyBaseRef.current = local; setWarranties(local); setWarrantiesLoadedFor(userId ?? '');
        notePortalRead('warranties', userId, false, readEpoch); // #23: the device cache, not the server's
      }
    })();
    return () => { cancelled = true; };
  // userId too: an account switch resets warranties with the other
  // per-account lists (render-phase reset above), and with canSync unchanged
  // (A → B) nothing else would reload them for B.
  }, [canSync, userId, warrantiesReload]);

  // persistWarranties is declared ABOVE (just before updateItemPortalState)
  // rather than here with the rest of the warranty helpers: updateItemPortalState
  // has to persist a warranty send/recall, and a forward reference from its
  // dependency array would hit the temporal dead zone. It only needs
  // setWarranties + saveLocal, both available from the top of the component, so
  // hoisting the helper is cheaper than relocating the two portal callbacks.

  const computeWarrantyStatus = useCallback((w: Warranty): Warranty['status'] => {
    // Delegate to the single shared implementation in utils/workflowPipelines
    // — the same local-calendar-day and open-claim rules the warranty chips
    // use (#135 / #144), so a tile and a chip cannot disagree.
    // NOTE (wave 5, corrected): 'unknown' is NOT impossible. A server row with
    // a null end_date maps to endDate '' and derives 'unknown' ("No end
    // date"), which WarrantyStatus does not list. It is stored as-is: no
    // counter matches it (none claims such a warranty is active or expiring),
    // and app/warranties.tsx re-derives its own display status, 'unknown'
    // included, rather than trusting this field.
    return warrantyStatus(w, Date.now()).key as Warranty['status'];
  }, []);

  const warrantyToRow = useCallback((w: Warranty) => ({
    id: w.id,
    user_id: userId,
    project_id: w.projectId,
    project_name: w.projectName ?? null,
    title: w.title,
    category: w.category,
    description: w.description ?? null,
    provider: w.provider ?? '',
    provider_contact_id: w.providerContactId ?? null,
    start_date: w.startDate || null,
    duration_months: w.durationMonths ?? 12,
    end_date: w.endDate || null,
    coverage_details: w.coverageDetails ?? null,
    exclusions: w.exclusions ?? null,
    document_uri: w.documentUri ?? null,
    status: w.status,
    claims: w.claims ?? [],
    reminder_days: w.reminderDays ?? null,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
    // Spread, not `?? null`. PostgREST writes only the keys present in the
    // payload, so omitting an undefined portalState PRESERVES the server value.
    // Writing null actively destroyed it: before the read mappers were fixed, a
    // refetch blanked portalState in memory and the very next edit persisted
    // that blank — turning a display bug into permanent data loss.
    ...(w.portalState !== undefined ? { portal_state: w.portalState } : {}),
  }), [userId]);

  const addWarranty = useCallback((w: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id?: string; status?: Warranty['status']; claims?: WarrantyClaim[] }) => {
    const now = new Date().toISOString();
    const fresh: Warranty = {
      id: w.id ?? generateUUID(),
      createdAt: now, updatedAt: now,
      status: w.status ?? 'active',
      claims: w.claims ?? [],
      ...w,
      portalState: w.portalState ?? initialPortalState('warranty', w.projectId),
    } as Warranty;
    fresh.status = computeWarrantyStatus(fresh);
    persistWarranties([fresh, ...warranties]);
    if (canSync && userId) void touchedWrite(proDocWriteTouchRef, fresh.id, () => supabaseWrite('warranties', 'insert', warrantyToRow(fresh)));
    return fresh;
  }, [warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow, initialPortalState]);

  const updateWarranty = useCallback((id: string, updates: Partial<Warranty>) => {
    const now = new Date().toISOString();
    const next = warranties.map(w => {
      if (w.id !== id) return w;
      const merged = { ...w, ...updates, updatedAt: now };
      merged.status = computeWarrantyStatus(merged);
      return merged;
    });
    persistWarranties(next);
    const after = next.find(w => w.id === id);
    if (canSync && userId && after) void touchedWrite(proDocWriteTouchRef, after.id, () => supabaseWrite('warranties', 'update', warrantyToRow(after)));
  }, [warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow]);

  const deleteWarranty = useCallback((id: string) => {
    persistWarranties(warranties.filter(w => w.id !== id));
    if (canSync) void touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('warranties', 'delete', { id }));
  }, [warranties, persistWarranties, canSync]);

  const getWarrantiesForProject = useCallback((projectId: string) =>
    warranties.filter(w => w.projectId === projectId).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()),
    [warranties]);

  const addWarrantyClaim = useCallback((warrantyId: string, claim: Omit<WarrantyClaim, 'id'>) => {
    const id = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newClaim: WarrantyClaim = { id, ...claim };
    // closeout (wave 5): the stored status follows the claim — an open claim
    // is 'claimed' (#144) — so the list, the tiles and the packet agree
    // without waiting for the next edit to recompute it.
    const next = warranties.map(w => {
      if (w.id !== warrantyId) return w;
      const withClaim: Warranty = { ...w, claims: [newClaim, ...(w.claims ?? [])], updatedAt: new Date().toISOString() };
      return { ...withClaim, status: computeWarrantyStatus(withClaim) };
    });
    persistWarranties(next);
    // Mirror the claim to Supabase so the warranty's claims jsonb stays in sync.
    const after = next.find(w => w.id === warrantyId);
    if (canSync && userId && after) void touchedWrite(proDocWriteTouchRef, after.id, () => supabaseWrite('warranties', 'update', warrantyToRow(after)));
  }, [warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow]);

  // Portal messages — client ↔ GC Q&A thread, local-only storage.
  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([]);

  // Per account (the device cache is wiped before a new session starts, so
  // this re-read is the new account's); a read that lands after its account
  // left is dropped.
  useEffect(() => {
    const owner = userId;
    void loadLocal<PortalMessage[]>(PORTAL_MESSAGES_KEY, []).then((list) => {
      if (liveUserIdRef.current === owner) setPortalMessages(list);
    });
  }, [userId]);

  const persistPortalMessages = useCallback((list: PortalMessage[]) => {
    setPortalMessages(list);
    void saveLocal(PORTAL_MESSAGES_KEY, list);
  }, []);

  const addPortalMessage = useCallback((msg: Omit<PortalMessage, 'id' | 'createdAt'>) => {
    const fresh: PortalMessage = {
      ...msg,
      id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    persistPortalMessages([...portalMessages, fresh]);
    return fresh;
  }, [portalMessages, persistPortalMessages]);

  const markPortalMessagesRead = useCallback((projectId: string, side: 'gc' | 'client') => {
    // Only persist if at least one message actually flipped — otherwise we'd
    // produce a new array reference on every call, change this callback's
    // identity, and refire any useEffect that depends on it. That was a
    // genuine infinite-loop crash on the Messages screen.
    let changed = false;
    const next = portalMessages.map(m => {
      if (m.projectId !== projectId) return m;
      if (side === 'gc' && m.authorType === 'client' && !m.readByGc) {
        changed = true;
        return { ...m, readByGc: true };
      }
      if (side === 'client' && m.authorType === 'gc' && !m.readByClient) {
        changed = true;
        return { ...m, readByClient: true };
      }
      return m;
    });
    if (changed) persistPortalMessages(next);
  }, [portalMessages, persistPortalMessages]);

  const getPortalMessagesForProject = useCallback((projectId: string) =>
    portalMessages
      .filter(m => m.projectId === projectId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [portalMessages]);

  const getUnreadPortalMessageCount = useCallback((projectId: string, side: 'gc' | 'client') =>
    portalMessages.filter(m =>
      m.projectId === projectId &&
      (side === 'gc' ? m.authorType === 'client' && !m.readByGc : m.authorType === 'gc' && !m.readByClient)
    ).length,
    [portalMessages]);

  const getTotalUnreadPortalCountForGc = useCallback(() =>
    portalMessages.filter(m => m.authorType === 'client' && !m.readByGc).length,
    [portalMessages]);

  // Plan sheets, drawing pins, markups, and calibrations — local-only
  // storage for now. Matches the portal-messages pattern above.
  const [planSheets, setPlanSheets] = useState<PlanSheet[]>([]);
  // Latest sheet list, readable synchronously (audit round 2, #18). addPlanSheet
  // built from its render closure, so N adds in one tick each wrote
  // `[fresh_i, ...original]` and only the last survived. Same pattern as
  // submittalsRef; persistPlanSheets writes it, the effect follows hydration.
  const planSheetsRef = useRef<PlanSheet[]>([]);
  useEffect(() => { planSheetsRef.current = planSheets; }, [planSheets]);
  const [drawingPins, setDrawingPins] = useState<DrawingPin[]>([]);
  // Latest pin list, readable synchronously — the planSheetsRef pattern. Pin
  // items moves a linked marker and Undo puts it back in the same few
  // gestures; built from a render closure, the second write started from a
  // list that did not have the first.
  // Follows state after every commit, so the account reset below (which
  // empties the state) empties this too.
  const drawingPinsRef = useRef<DrawingPin[]>([]);
  useEffect(() => { drawingPinsRef.current = drawingPins; }, [drawingPins]);
  const [planZones, setPlanZones] = useState<PlanZone[]>([]);
  const [planReviews, setPlanReviews] = useState<PlanReview[]>([]);
  const [planMarkups, setPlanMarkups] = useState<PlanMarkup[]>([]);
  const [planCalibrations, setPlanCalibrations] = useState<PlanCalibration[]>([]);
  const [permitRoadmaps, setPermitRoadmaps] = useState<PermitRoadmap[]>([]);
  // Keyed by account, like punchItemsLoadedFor ('' = signed out).
  const [planSheetsLoadedFor, setPlanSheetsLoadedFor] = useState<string | null>(null);
  const planSheetsLoaded = !authLoading && planSheetsLoadedFor === (userId ?? '');
  // The account reset above, for the lists declared here (their state is
  // below that reset, so it cannot name them). Same render-phase pattern:
  // after A → B, B's Universal Search listed A's sheet names, pin labels,
  // markup text and portal-message bodies until something reloaded them, and
  // B's next plan write saved A's rows into B's device cache.
  const [plansAccountEpoch, setPlansAccountEpoch] = useState(accountEpochRef.current);
  if (plansAccountEpoch !== accountEpochRef.current) {
    setPlansAccountEpoch(accountEpochRef.current);
    planSheetsRef.current = [];
    setPlanSheets([]); setDrawingPins([]); setPlanZones([]); setPlanReviews([]);
    setPlanMarkups([]); setPlanCalibrations([]); setPermitRoadmaps([]); setPortalMessages([]);
  }

  // PLAN DATA WAS WRITE-ONLY TO THE SERVER. plan_sheets, drawing_pins,
  // plan_markups and plan_calibrations had ELEVEN supabaseWrite calls between
  // them and ZERO selects — everything synced up and nothing ever came back
  // down. Hydration was loadLocal only, so a second device (or any device after
  // a cache wipe or a fresh install) showed no sheets, no pins, no markups and
  // no scale calibration, while all of it sat intact in Supabase. For a GC who
  // marked up drawings on an iPad and opened the web app, the plans were simply
  // gone.
  //
  // Same shape as every other read/write asymmetry found this week, just at the
  // table level rather than the column level: local-first is only "first" if a
  // server read follows it.
  // The SERVER half of the plans load (#74), shared by the launch hydration
  // and every re-read. `refetch` re-reads keep device rows the server did not
  // return (unionServerFirst) instead of replacing the lists.
  const pullPlansFromServer = useCallback(async (opts: {
    refetch: boolean;
    lSheets: PlanSheet[];
    stillMine: () => boolean;
    markSheetsLoaded: () => void;
  }) => {
    const { refetch, lSheets, stillMine, markSheetsLoaded } = opts;
    // Refs and setters only; the ref objects are stable.
    // #74 review round: a plan write that went out DIRECTLY (never queued, so
    // planWritesQueued cannot see it) and raced this read keeps the device
    // row — the read may predate it (idsWrittenDuringRead). The launch read
    // replaces the lists and needs none of this.
    const readStartedAt = Date.now();
    const writtenDuringRead = () => (refetch ? idsWrittenDuringRead(planWriteTouchRef.current, readStartedAt) : new Set<string>());
    try {
      const [sheets, pins, markups, cals] = await Promise.all([
        supabase.from('plan_sheets').select('*').order('created_at', { ascending: false }),
        supabase.from('drawing_pins').select('*'),
        supabase.from('plan_markups').select('*'),
        supabase.from('plan_calibrations').select('*'),
      ]);
      if (!stillMine()) return;

      if (!sheets.error && sheets.data?.length) {
        // DB-F11. Sign every stored plan-sheet path in ONE batched request
        // before mapping, so the rest of the app keeps reading `imageUri`.
        // A row that cannot be signed — offline, or the held migration not
        // applied yet so there is still no SELECT policy — keeps whatever it
        // stored, which for a legacy row is a public URL that still renders.
        const sheetSigned = await resolvePlanSheetUrls(
          sheets.data.map((r: Record<string, unknown>) => (r.image_uri as string) ?? ''),
        );
        if (!stillMine()) return;
        const mapped = sheets.data.map((r: Record<string, unknown>) => ({
          id: r.id as string, projectId: r.project_id as string,
          name: (r.name as string) ?? '',
          sheetNumber: (r.sheet_number as string | null) ?? undefined,
          // planSheetRowUris is the extracted, guarded mapper: signed url for
          // rendering + a storagePath ONLY when the key is project-scoped.
          ...planSheetRowUris(r.image_uri as string, sheetSigned),
          pageNumber: r.page_number == null ? undefined : Number(r.page_number),
          width: r.width == null ? undefined : Number(r.width),
          height: r.height == null ? undefined : Number(r.height),
          revision: (r.revision as string | null) ?? undefined,
          previousSheetId: (r.previous_sheet_id as string | null) ?? undefined,
          superseded: r.superseded == null ? undefined : Boolean(r.superseded),
          createdAt: r.created_at as string, updatedAt: r.updated_at as string,
          // #118: who added it — plan_sheets_collab_delete lets the uploader
          // (or the project owner) delete it, and the plans screen asks per
          // sheet. Read-only: user_id is written on insert only.
          userId: (r.user_id as string | null) ?? undefined,
        })) as PlanSheet[];
        // A photo-library import has no storage object, so its row holds '' —
        // keep this device's copy rather than blanking what the user just saw.
        const carried = carryDeviceLocalPlanSheetUris(mapped, lSheets);
        // A RE-read (#74) keeps a device sheet the server did not return —
        // one imported moments ago whose write is on the wire — instead of
        // replacing the list; the launch read replaces it as it always has.
        const merged = refetch ? unionServerFirst(carried, planSheetsRef.current, writtenDuringRead()) : carried;
        if (refetch) planSheetsRef.current = merged;
        setPlanSheets(merged);
        // The LOCAL cache gets the durable value, never the signed URL: a cached
        // signature outlives its TTL and comes back as a dead image on the next
        // offline open (utils/storage.ts:11-14 is the same bug, in Postgres).
        await saveLocal(PLAN_SHEETS_KEY, merged.map(s => ({
          ...s, imageUri: localPlanSheetValue(s.storagePath, s.imageUri),
        })));
      }
      markSheetsLoaded();

      if (!stillMine()) return;
      if (!pins.error && pins.data?.length) {
        const mapped = pins.data.map((r: Record<string, unknown>) => ({
          id: r.id as string, projectId: r.project_id as string,
          planSheetId: r.plan_sheet_id as string,
          x: Number(r.x), y: Number(r.y),
          kind: r.kind as DrawingPin['kind'],
          label: (r.label as string | null) ?? undefined,
          color: (r.color as string | null) ?? undefined,
          linkedPhotoId: (r.linked_photo_id as string | null) ?? undefined,
          linkedPunchItemId: (r.linked_punch_item_id as string | null) ?? undefined,
          linkedRfiId: (r.linked_rfi_id as string | null) ?? undefined,
          createdAt: r.created_at as string, updatedAt: r.updated_at as string,
        })) as DrawingPin[];
        const next = refetch ? unionServerFirst(mapped, drawingPinsRef.current, writtenDuringRead()) : mapped;
        if (refetch) drawingPinsRef.current = next;
        setDrawingPins(next);
        await saveLocal(DRAWING_PINS_KEY, next);
      }

      if (!stillMine()) return;
      if (!markups.error && markups.data?.length) {
        const mapped = markups.data.map((r: Record<string, unknown>) => ({
          id: r.id as string, projectId: r.project_id as string,
          planSheetId: r.plan_sheet_id as string,
          type: r.type as PlanMarkup['type'],
          color: (r.color as string) ?? '',
          strokeWidth: r.stroke_width == null ? undefined : Number(r.stroke_width),
          points: (r.points as PlanMarkup['points']) ?? [],
          text: (r.text as string | null) ?? undefined,
          createdAt: r.created_at as string,
        })) as PlanMarkup[];
        if (refetch) {
          setPlanMarkups(prev => { const next = unionServerFirst(mapped, prev, writtenDuringRead()); void saveLocal(PLAN_MARKUPS_KEY, next); return next; });
        } else {
          setPlanMarkups(mapped);
          await saveLocal(PLAN_MARKUPS_KEY, mapped);
        }
      }

      if (!stillMine()) return;
      if (!cals.error && cals.data?.length) {
        const mapped = cals.data.map((r: Record<string, unknown>) => ({
          id: r.id as string, projectId: r.project_id as string,
          planSheetId: r.plan_sheet_id as string,
          p1: r.p1 as PlanCalibration['p1'], p2: r.p2 as PlanCalibration['p2'],
          realDistanceFt: Number(r.real_distance_ft),
          createdAt: r.created_at as string,
        })) as PlanCalibration[];
        if (refetch) {
          setPlanCalibrations(prev => { const next = unionServerFirst(mapped, prev, writtenDuringRead()); void saveLocal(PLAN_CALIBRATIONS_KEY, next); return next; });
        } else {
          setPlanCalibrations(mapped);
          await saveLocal(PLAN_CALIBRATIONS_KEY, mapped);
        }
      }
    } catch {
      // Offline or the tables are unreachable — the local copy loaded below
      // still stands, which is the whole point of local-first.
    }
  }, []);

  // #74 · Re-read the plans from the server WITHOUT the local-first paint (the
  // disk copy can be older than memory, and re-painting it flashed old data).
  // A phone left open on site never learned that the office filed a new
  // revision — the super kept building from the superseded sheet. Run on
  // return to the foreground (the 30 s gate, below), after a plan write
  // flushes, and by the Plans screens (exposed on the context). Skipped while
  // any plan write is still queued: its row would come back without the
  // write, and the server-first sheet list would lose an offline import.
  const refetchPlansFromServer = useCallback(async (): Promise<void> => {
    if (!canSync || !userId) return;
    const owner = userId;
    const stillMine = () => liveUserIdRef.current === owner;
    try {
      if (planWritesQueued(await getOfflineQueue())) return;
    } catch { return; }
    const lSheets = await loadLocal<PlanSheet[]>(PLAN_SHEETS_KEY, []);
    if (!stillMine()) return;
    await pullPlansFromServer({ refetch: true, lSheets, stillMine, markSheetsLoaded: () => undefined });
  }, [canSync, userId, pullPlansFromServer]);
  useProjectsFocusRefetch(canSync, refetchPlansFromServer);
  const refetchPlansRef = useRef(refetchPlansFromServer);
  useEffect(() => { refetchPlansRef.current = refetchPlansFromServer; }, [refetchPlansFromServer]);

  const hydratePlansFromServer = useCallback(async () => {
    // Per account: re-run when the account changes (A → B through a magic
    // link or a password-reset session moves the account without a sign-out,
    // so canSync alone never re-ran it), and a pass whose account left before
    // it finished writes nothing — not to the screen, not to the cache.
    const owner = userId;
    const stillMine = () => liveUserIdRef.current === owner;
    // The sheet list is as complete as it will get for now: the local copy
    // (and, when syncing, the server's answer — or its failure) is in.
    const markSheetsLoaded = () => { if (stillMine()) setPlanSheetsLoadedFor(owner ?? ''); };
    // Local first, IN THIS FLOW. Keeping the local load in a separate effect
    // raced the server fetch: both are async, so a slow AsyncStorage read could
    // resolve last and overwrite fresh server rows with a stale cache. Doing it
    // sequentially means the screen paints instantly from disk and the server
    // copy wins whenever it arrives.
    const [lSheets, lPins, lMarkups, lCals] = await Promise.all([
      loadLocal<PlanSheet[]>(PLAN_SHEETS_KEY, []),
      loadLocal<DrawingPin[]>(DRAWING_PINS_KEY, []),
      loadLocal<PlanMarkup[]>(PLAN_MARKUPS_KEY, []),
      loadLocal<PlanCalibration[]>(PLAN_CALIBRATIONS_KEY, []),
    ]);
    if (!stillMine()) return;
    setPlanSheets(lSheets);
    setDrawingPins(lPins);
    setPlanMarkups(lMarkups);
    setPlanCalibrations(lCals);

    // DB-F11. The cached sheets hold storage PATHS (see the saveLocal below), so
    // they need signing before anything can render them. Do it right after the
    // instant paint and before the server round-trip, so a slow or failing
    // fetch still leaves a viewable set of plans rather than a blank list.
    //
    // KNOWN LIMIT, deliberately not papered over: with the bucket private and
    // the device offline, nothing can sign and the sheets do not render. Photos
    // survive that case because the capture device keeps a `localUri`; plan
    // sheets arrive from the server and have no local copy. Giving them one
    // (download-on-import, same shape as photoUploadQueue in reverse) is the
    // follow-up — it is not something a signed URL can fix.
    if (lSheets.length > 0) {
      const cachedSigned = await resolvePlanSheetUrls(lSheets.map(s => s.imageUri));
      if (!stillMine()) return;
      if (cachedSigned.size > 0) {
        setPlanSheets(lSheets.map(s => ({ ...s, ...planSheetRowUris(s.imageUri, cachedSigned) })));
      }
    }

    if (!canSync) { markSheetsLoaded(); return; }
    await pullPlansFromServer({ refetch: false, lSheets, stillMine, markSheetsLoaded });
    // Whatever happened above, the pass is over (a no-op if already marked).
    markSheetsLoaded();
  }, [canSync, userId, pullPlansFromServer]);

  useEffect(() => { void hydratePlansFromServer(); }, [hydratePlansFromServer]);

  // Wave 5 (settings #3/#4) · After "Reset this device" swept the caches: the
  // plan lists live in memory, outside react-query, so the reset's
  // invalidations never touched them — and a re-read UNIONS device rows the
  // server did not return (unionServerFirst), so a sheet whose upload sat in
  // the wiped queue stayed on screen and the next plan edit wrote it back to
  // disk. Empty them, re-read the (now empty) device copies of the local-only
  // lists, and run the launch hydration, which REPLACES the lists with the
  // server's.
  const reloadLocalMirrors = useCallback(async (): Promise<void> => {
    planSheetsRef.current = [];
    drawingPinsRef.current = [];
    setPlanSheets([]); setDrawingPins([]); setPlanMarkups([]); setPlanCalibrations([]);
    const owner = userId;
    const [zones, reviews, roadmaps] = await Promise.all([
      loadLocal<PlanZone[]>(PLAN_ZONES_KEY, []),
      loadLocal<PlanReview[]>(PLAN_REVIEWS_KEY, []),
      loadLocal<PermitRoadmap[]>(PLAN_ROADMAPS_KEY, []),
    ]);
    if (liveUserIdRef.current !== owner) return;
    setPlanZones(zones); setPlanReviews(reviews); setPermitRoadmaps(roadmaps);
    await hydratePlansFromServer();
  }, [userId, hydratePlansFromServer]);

  useEffect(() => {
    const owner = userId;
    const mine = <T,>(set: (v: T) => void) => (v: T) => { if (liveUserIdRef.current === owner) set(v); };
    void loadLocal<PlanZone[]>(PLAN_ZONES_KEY, []).then(mine(setPlanZones));
    void loadLocal<PlanReview[]>(PLAN_REVIEWS_KEY, []).then(mine(setPlanReviews));
    void loadLocal<PermitRoadmap[]>(PLAN_ROADMAPS_KEY, []).then(mine(setPermitRoadmaps));
  }, [userId]);

  const persistPlanSheets = useCallback((list: PlanSheet[]) => {
    planSheetsRef.current = list;
    setPlanSheets(list);
    // In MEMORY the sheets carry the renderable (signed) url; on DISK they carry
    // the durable path — a cached signature would expire and come back as a dead
    // image. DB-F11.
    //
    // localPlanSheetValue, not durablePlanSheetValue: the DISK copy keeps a
    // device-local `file://` when that is all a sheet has (app/plans.tsx
    // `confirmImport` — a photo of a plan, never uploaded). Postgres still gets
    // '' for that sheet; the cache is the device that took it.
    void saveLocal(PLAN_SHEETS_KEY, list.map(s => ({
      ...s, imageUri: localPlanSheetValue(s.storagePath, s.imageUri),
    })));
  }, []);
  const persistDrawingPins = useCallback((list: DrawingPin[]) => {
    drawingPinsRef.current = list;
    setDrawingPins(list);
    void saveLocal(DRAWING_PINS_KEY, list);
  }, []);
  const persistPlanZones = useCallback((list: PlanZone[]) => {
    setPlanZones(list);
    void saveLocal(PLAN_ZONES_KEY, list);
  }, []);
  const persistPlanReviews = useCallback((list: PlanReview[]) => {
    setPlanReviews(list);
    void saveLocal(PLAN_REVIEWS_KEY, list);
  }, []);
  const persistPlanMarkups = useCallback((list: PlanMarkup[]) => {
    setPlanMarkups(list);
    void saveLocal(PLAN_MARKUPS_KEY, list);
  }, []);
  const persistPlanCalibrations = useCallback((list: PlanCalibration[]) => {
    setPlanCalibrations(list);
    void saveLocal(PLAN_CALIBRATIONS_KEY, list);
  }, []);
  const persistPermitRoadmaps = useCallback((list: PermitRoadmap[]) => {
    setPermitRoadmaps(list);
    void saveLocal(PLAN_ROADMAPS_KEY, list);
  }, []);

  // Auto-detect a revision: if the project already has a non-superseded sheet
  // with the same sheetNumber, the new upload becomes Rev N+1 and the prior
  // sheet gets marked superseded. Pre-fix every upload landed as a brand-new
  // row, so two copies of "A-101" lived side by side with no relationship.
  // Now revisions stack and the list view shows only the latest of each.
  //
  // ONE path for one sheet and for many (audit round 2, #18): both fold into
  // planSheetsRef.current — never the render's `planSheets` — persist ONCE and
  // queue one insert per created sheet. Looping addPlanSheet over a PDF's pages
  // used to keep only the last page; a single add right after another (the
  // image import after a PDF) could drop a sheet the same way.
  const commitPlanSheets = useCallback((
    incoming: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>[],
    matchUnnumberedByPage: boolean,
  ) => {
    const now = new Date().toISOString();
    // #118: stamp the uploader on the device copy (plan_sheets.user_id is the
    // insert's userId), so a fresh import can be deleted by the editor who
    // made it before the next re-read maps the row's user_id back.
    const sheets = incoming.map(sh => (sh.userId ? sh : { ...sh, userId: userId ?? undefined }));
    const fold = foldPlanSheets(planSheetsRef.current, sheets, {
      now,
      // UUID (not a prefixed timestamp) so the Supabase write path can
      // round-trip the id into a Postgres UUID column without rejection.
      newId: generateUUID,
      matchUnnumberedByPage,
    });
    if (fold.created.length === 0) return fold;
    persistPlanSheets(fold.list);
    if (canSync) {
      // Inserts first: a superseded flag for a row this batch created is
      // already on its insert (planSheetBatchCore), so every update below
      // targets a row the server has.
      for (const fresh of fold.created) {
        void trackedWrite(planWriteTouchRef, 'plan_sheets', 'insert', {
          id: fresh.id, user_id: userId, project_id: fresh.projectId,
          name: fresh.name, sheet_number: fresh.sheetNumber ?? null,
          // The PATH, never the signed url and never the old permanent public one.
          // This column is what DB-F11 was about.
          image_uri: durablePlanSheetValue(fresh.storagePath, fresh.imageUri),
          page_number: fresh.pageNumber ?? null,
          width: fresh.width ?? null, height: fresh.height ?? null,
          revision: fresh.revision ?? null,
          previous_sheet_id: fresh.previousSheetId ?? null,
          superseded: fresh.superseded ?? null,
          created_at: fresh.createdAt, updated_at: fresh.updatedAt,
        });
      }
      // Mark the prior latest superseded on the server too, so other devices
      // see the same chain.
      for (const old of fold.superseded) {
        void trackedWrite(planWriteTouchRef, 'plan_sheets', 'update', {
          id: old.id, superseded: true, updated_at: now,
        });
      }
    }
    return fold;
  }, [persistPlanSheets, canSync, userId]);

  const addPlanSheet = useCallback((sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>) =>
    commitPlanSheets([sheet], false).created[0], [commitPlanSheets]);

  const addPlanSheets = useCallback((
    sheets: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>[],
    opts?: { matchUnnumberedByPage?: boolean },
  ) => {
    const fold = commitPlanSheets(sheets, !!opts?.matchUnnumberedByPage);
    return { created: fold.created, superseded: fold.superseded };
  }, [commitPlanSheets]);

  const updatePlanSheet = useCallback((id: string, updates: Partial<PlanSheet>) => {
    const now = new Date().toISOString();
    // Read the ref, not the render's `planSheets` (same rule as commitPlanSheets):
    // an update in the same tick as an add would otherwise drop the new sheet.
    const list = planSheetsRef.current;
    persistPlanSheets(list.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s));
    if (canSync) {
      // Only forward persisted columns — `projectId` is immutable after
      // creation, so we never write it on update.
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.sheetNumber !== undefined) patch.sheet_number = updates.sheetNumber;
      if (updates.imageUri !== undefined || updates.storagePath !== undefined) {
        const current = list.find(s => s.id === id);
        patch.image_uri = durablePlanSheetValue(
          updates.storagePath ?? current?.storagePath,
          updates.imageUri ?? current?.imageUri,
        );
      }
      if (updates.pageNumber !== undefined) patch.page_number = updates.pageNumber;
      if (updates.width !== undefined) patch.width = updates.width;
      if (updates.height !== undefined) patch.height = updates.height;
      // The revision chain too (plans-revisions handoff 3) — the same three
      // columns chainColumnsPatch names; the screens' own explicit chain
      // writes are idempotent with this and can go later.
      if (updates.revision !== undefined) patch.revision = updates.revision;
      if (updates.previousSheetId !== undefined) patch.previous_sheet_id = updates.previousSheetId;
      if (updates.superseded !== undefined) patch.superseded = updates.superseded;
      void trackedWrite(planWriteTouchRef, 'plan_sheets', 'update', { id, ...patch });
    }
  }, [persistPlanSheets, canSync]);

  const deletePlanSheet = useCallback((id: string) => {
    // #118: deleting the LATEST revision (a wrong import) makes the sheet it
    // replaced current again — un-supersede it here and on the server, or the
    // set is left with no current sheet for that number (planSheetsAfterDelete).
    const now = new Date().toISOString();
    const { restoredId } = planSheetsAfterDelete(planSheetsRef.current, id, now);
    persistPlanSheets(planSheetsRef.current.filter(s => s.id !== id).map(s => (s.id === restoredId ? { ...s, superseded: false, updatedAt: now } : s)));
    // cascade: pins, markups, calibrations on that sheet.
    // Server side relies on ON DELETE CASCADE from plan_sheets — we only
    // need to issue the parent delete. Local state still needs the manual
    // fan-out because AsyncStorage doesn't have FK cascades.
    persistDrawingPins(drawingPins.filter(p => p.planSheetId !== id));
    persistPlanMarkups(planMarkups.filter(m => m.planSheetId !== id));
    persistPlanCalibrations(planCalibrations.filter(c => c.planSheetId !== id));
    if (canSync) {
      void trackedWrite(planWriteTouchRef, 'plan_sheets', 'delete', { id });
      if (restoredId) void trackedWrite(planWriteTouchRef, 'plan_sheets', 'update', { id: restoredId, superseded: false, updated_at: now });
    }
  }, [drawingPins, planMarkups, planCalibrations, persistPlanSheets, persistDrawingPins, persistPlanMarkups, persistPlanCalibrations, canSync]);

  const getPlanSheetsForProject = useCallback((projectId: string) =>
    planSheets.filter(s => s.projectId === projectId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [planSheets]);

  const getPlanSheet = useCallback((id: string) => planSheets.find(s => s.id === id), [planSheets]);

  // FIELD DAY PACK. Pull the plan sheets for every jobsite scheduled today and
  // tomorrow onto the device while there is still signal, inside ONE bounded
  // budget — instead of the previous behaviour, which warmed only whichever
  // project's detail screen the user happened to open. Mounted here because
  // this is where `projects` and `planSheets` live; everything it does (the
  // budget, the fair share, the staleness rules, the copy) is in
  // utils/fieldDayPackCore.ts and hooks/useFieldDayPack.ts. Warms at most once
  // every three hours, records only what the prefetch confirmed, and never
  // surfaces an error — a warm that does not happen is a slower plan open, not
  // a broken screen.
  useFieldDayPackWarmer(projects, planSheets);

  const addDrawingPin = useCallback((pin: Omit<DrawingPin, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: DrawingPin = {
      ...pin,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    persistDrawingPins([fresh, ...drawingPinsRef.current]);
    if (canSync) {
      void trackedWrite(planWriteTouchRef, 'drawing_pins', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        plan_sheet_id: fresh.planSheetId, x: fresh.x, y: fresh.y,
        kind: fresh.kind, label: fresh.label ?? null, color: fresh.color ?? null,
        linked_photo_id: fresh.linkedPhotoId ?? null,
        linked_punch_item_id: fresh.linkedPunchItemId ?? null,
        linked_rfi_id: fresh.linkedRfiId ?? null,
        created_at: fresh.createdAt, updated_at: fresh.updatedAt,
      });
    }
    return fresh;
  }, [persistDrawingPins, canSync, userId]);

  const updateDrawingPin = useCallback((id: string, updates: Partial<DrawingPin>) => {
    const now = new Date().toISOString();
    persistDrawingPins(drawingPinsRef.current.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p));
    if (canSync) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.x !== undefined) patch.x = updates.x;
      if (updates.y !== undefined) patch.y = updates.y;
      if (updates.label !== undefined) patch.label = updates.label;
      if (updates.color !== undefined) patch.color = updates.color;
      if (updates.kind !== undefined) patch.kind = updates.kind;
      if (updates.linkedPhotoId !== undefined) patch.linked_photo_id = updates.linkedPhotoId;
      // A marker that follows its punch item to another sheet (Move pin).
      if (updates.planSheetId !== undefined) patch.plan_sheet_id = updates.planSheetId;
      // `in`, not `!== undefined`: unlinking sends undefined, which must reach
      // the server as NULL or the link comes back on the next load.
      if ('linkedPunchItemId' in updates) patch.linked_punch_item_id = updates.linkedPunchItemId ?? null;
      if (updates.linkedRfiId !== undefined) patch.linked_rfi_id = updates.linkedRfiId;
      void trackedWrite(planWriteTouchRef, 'drawing_pins', 'update', { id, ...patch });
    }
  }, [persistDrawingPins, canSync]);

  const deleteDrawingPin = useCallback((id: string) => {
    persistDrawingPins(drawingPinsRef.current.filter(p => p.id !== id));
    if (canSync) void trackedWrite(planWriteTouchRef, 'drawing_pins', 'delete', { id });
  }, [persistDrawingPins, canSync]);

  const getPinsForPlan = useCallback((planSheetId: string) =>
    drawingPins.filter(p => p.planSheetId === planSheetId),
    [drawingPins]);

  const getPinsForPhoto = useCallback((photoId: string) =>
    drawingPins.filter(p => p.linkedPhotoId === photoId),
    [drawingPins]);

  const addPlanZone = useCallback((zone: Omit<PlanZone, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: PlanZone = { ...zone, id: generateUUID(), createdAt: now, updatedAt: now };
    persistPlanZones([fresh, ...planZones]);
    return fresh;
  }, [planZones, persistPlanZones]);

  const updatePlanZone = useCallback((id: string, patch: Partial<PlanZone>) => {
    persistPlanZones(planZones.map((z) => (z.id === id ? { ...z, ...patch, updatedAt: new Date().toISOString() } : z)));
  }, [planZones, persistPlanZones]);

  const deletePlanZone = useCallback((id: string) => {
    persistPlanZones(planZones.filter((z) => z.id !== id));
  }, [planZones, persistPlanZones]);

  const getPlanZonesForPlan = useCallback((planSheetId: string) => planZones.filter((z) => z.planSheetId === planSheetId), [planZones]);
  const getPlanZonesForProject = useCallback((projectId: string) => planZones.filter((z) => z.projectId === projectId), [planZones]);

  const getPlanReviewForSheet = useCallback((planSheetId: string): PlanReview | null =>
    planReviews.find((r) => r.planSheetId === planSheetId) ?? null, [planReviews]);

  const savePlanReview = useCallback((review: PlanReview) => {
    // upsert one review per plan sheet
    persistPlanReviews([review, ...planReviews.filter((r) => r.planSheetId !== review.planSheetId)]);
  }, [planReviews, persistPlanReviews]);

  const updatePlanReview = useCallback((id: string, patch: Partial<PlanReview>) => {
    persistPlanReviews(planReviews.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, [planReviews, persistPlanReviews]);

  const deletePlanReview = useCallback((id: string) => {
    persistPlanReviews(planReviews.filter((r) => r.id !== id));
  }, [planReviews, persistPlanReviews]);

  const addPlanMarkup = useCallback((markup: Omit<PlanMarkup, 'id' | 'createdAt'>) => {
    const fresh: PlanMarkup = {
      ...markup,
      id: generateUUID(),
      createdAt: new Date().toISOString(),
    };
    persistPlanMarkups([fresh, ...planMarkups]);
    if (canSync) {
      void trackedWrite(planWriteTouchRef, 'plan_markups', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        plan_sheet_id: fresh.planSheetId, type: fresh.type, color: fresh.color,
        stroke_width: fresh.strokeWidth ?? null,
        points: fresh.points, text: fresh.text ?? null,
        created_at: fresh.createdAt,
      });
    }
    return fresh;
  }, [planMarkups, persistPlanMarkups, canSync, userId]);

  const deletePlanMarkup = useCallback((id: string) => {
    persistPlanMarkups(planMarkups.filter(m => m.id !== id));
    if (canSync) void trackedWrite(planWriteTouchRef, 'plan_markups', 'delete', { id });
  }, [planMarkups, persistPlanMarkups, canSync]);

  const getMarkupsForPlan = useCallback((planSheetId: string) =>
    planMarkups.filter(m => m.planSheetId === planSheetId),
    [planMarkups]);

  const upsertPlanCalibration = useCallback((cal: Omit<PlanCalibration, 'id' | 'createdAt'>) => {
    const existing = planCalibrations.find(c => c.planSheetId === cal.planSheetId);
    if (existing) {
      const next: PlanCalibration = { ...existing, ...cal };
      persistPlanCalibrations(planCalibrations.map(c => c.id === existing.id ? next : c));
      if (canSync) {
        // The row keeps its id, so this MUST be 'upsert' (ON CONFLICT (id) DO
        // UPDATE): 'insert' is a plain insert that the server refuses on
        // plan_calibrations_pkey online, and that the offline flush drops as
        // "already landed" — so a re-check never reached the server and the
        // next hydrate brought the old scale back. If the first insert is
        // still queued it lands first, and this replaces it in order.
        void trackedWrite(planWriteTouchRef, 'plan_calibrations', 'upsert', {
          id: next.id, user_id: userId, project_id: next.projectId,
          plan_sheet_id: next.planSheetId,
          p1: next.p1, p2: next.p2, real_distance_ft: next.realDistanceFt,
          created_at: next.createdAt,
        });
      }
      return next;
    }
    const fresh: PlanCalibration = {
      ...cal,
      id: generateUUID(),
      createdAt: new Date().toISOString(),
    };
    persistPlanCalibrations([fresh, ...planCalibrations]);
    if (canSync) {
      void trackedWrite(planWriteTouchRef, 'plan_calibrations', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        plan_sheet_id: fresh.planSheetId,
        p1: fresh.p1, p2: fresh.p2, real_distance_ft: fresh.realDistanceFt,
        created_at: fresh.createdAt,
      });
    }
    return fresh;
  }, [planCalibrations, persistPlanCalibrations, canSync, userId]);

  const getCalibrationForPlan = useCallback((planSheetId: string) =>
    planCalibrations.find(c => c.planSheetId === planSheetId),
    [planCalibrations]);

  const getPermitRoadmapForProject = useCallback((projectId: string) =>
    permitRoadmaps.find((r) => r.projectId === projectId),
    [permitRoadmaps]);
  const savePermitRoadmap = useCallback((roadmap: PermitRoadmap) => {
    persistPermitRoadmaps([roadmap, ...permitRoadmaps.filter((r) => r.projectId !== roadmap.projectId)]);
  }, [permitRoadmaps, persistPermitRoadmaps]);
  const updatePermitRoadmap = useCallback((id: string, patch: Partial<PermitRoadmap>) => {
    persistPermitRoadmaps(permitRoadmaps.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, [permitRoadmaps, persistPermitRoadmaps]);
  const deletePermitRoadmap = useCallback((id: string) => {
    persistPermitRoadmaps(permitRoadmaps.filter((r) => r.id !== id));
  }, [permitRoadmaps, persistPermitRoadmaps]);

  // Deleting a project CASCADES: the project row AND every project-scoped child
  // record across every collection are removed. Without this, deleting a project
  // orphaned every child on disk — a privacy/storage leak, and on web
  // AsyncStorage is shared per-origin localStorage. Kept next to the persist
  // helpers so each collection is torn down through its OWN persistence path
  // (mutation or persistX), never a raw setState that skips the write.
  //
  // Scope rules:
  //  - COIs: CertificateOfInsurance.projectId is OPTIONAL. A null/undefined
  //    projectId is the sub's blanket cert on file — keep it. Only project-
  //    specific COIs (projectId === id) are removed.
  //  - Equipment / Subcontractors / contacts / leads / priceAlerts / commEvents
  //    are company-global, NOT project-scoped, so they are intentionally NOT
  //    cascaded. (Equipment.currentProjectId is a soft assignment, not
  //    ownership — the asset survives the project.)
  //  - plan sub-collections (drawingPins/planZones/planReviews/planMarkups/
  //    planCalibrations) each carry a `projectId` of their own, so they can be
  //    filtered directly; we also clear the parent planSheets in the same pass.
  //
  // Server side: syncProjectToSupabase(toDelete, 'delete') issues the parent
  // row delete only; child tables are expected to clean up via ON DELETE
  // CASCADE foreign keys (same contract deletePlanSheet already relies on).
  // Drop jobs from THIS DEVICE only: every project-scoped child collection
  // (state + cache) and the deletion signal provider-siblings prune on. No
  // server write — deleteProject sends its own parent delete, and a job he was
  // REMOVED from (#90) is not his to delete. Shared so the two can never
  // disagree about which collections a job owns (validate-project-cascade).
  const forgetProjectsLocally = useCallback((ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    // Cascade every project-scoped child collection through its own
    //    persistence mechanism. Each block: filter out this project's records,
    //    set state, persist. Only touch a collection if it actually shrank, so
    //    we don't churn AsyncStorage / query cache for projects with no data of
    //    that kind.
    const cascadeMutation = <T extends { projectId?: string }>(
      list: T[],
      setState: (next: T[]) => void,
      mutation: { mutate: (next: T[]) => void },
    ) => {
      const next = list.filter(r => !r.projectId || !ids.has(r.projectId));
      if (next.length === list.length) return;
      setState(next);
      mutation.mutate(next);
    };
    const cascadePersist = <T extends { projectId?: string }>(
      list: T[],
      persist: (next: T[]) => void,
    ) => {
      const next = list.filter(r => !r.projectId || !ids.has(r.projectId));
      if (next.length === list.length) return;
      persist(next);
    };

    // --- collections persisted via saveXMutation (state setter + mutation) ---
    cascadeMutation(changeOrders, setChangeOrders, saveChangeOrdersMutation);
    cascadeMutation(invoices, setInvoices, saveInvoicesMutation);
    cascadeMutation(commitments, setCommitments, saveCommitmentsMutation);
    cascadeMutation(dailyReports, setDailyReports, saveDailyReportsMutation);
    cascadeMutation(fieldTickets, setFieldTickets, saveFieldTicketsMutation);
    cascadeMutation(delayEvents, setDelayEvents, saveDelayEventsMutation);
    cascadeMutation(deliveries, setDeliveries, saveDeliveriesMutation);
    // Building access: the rules row is keyed by projectId, the reservations
    // carry one. Both are as project-scoped as it gets — a building's elevator
    // rules mean nothing once the job is gone.
    cascadeMutation(buildingAccessRules, setBuildingAccessRules, saveBuildingAccessMutation);
    cascadeMutation(accessReservations, setAccessReservations, saveReservationsMutation);
    cascadeMutation(deliveryReceipts, setDeliveryReceipts, saveDeliveryReceiptsMutation);
    cascadeMutation(punchItems, setPunchItems, savePunchItemsMutation);
    cascadeMutation(projectPhotos, setProjectPhotos, savePhotosMutation);
    cascadeMutation(rfis, setRfis, saveRfisMutation);
    cascadeMutation(submittals, setSubmittals, saveSubmittalsMutation);
    cascadeMutation(oacMeetings, setOacMeetings, saveOACMeetingsMutation);
    cascadeMutation(permits, setPermits, savePermitsMutation);
    cascadeMutation(aiaPayApps, setAiaPayApps, saveAiaPayAppsMutation);
    cascadeMutation(subPortalLinks, setSubPortalLinks, saveSubPortalLinksMutation);
    // commEvents are project-scoped (CommunicationEvent.projectId is required and
    // getCommEventsForProject filters on it), so they cascade like the rest.
    cascadeMutation(commEvents, setCommEvents, saveCommEventsMutation);

    // COIs: keep blanket certs (projectId undefined/null) and other projects'
    // certs — only drop this project's project-specific COIs.
    {
      const nextCois = cois.filter(c => !c.projectId || !ids.has(c.projectId));
      if (nextCois.length !== cois.length) {
        setCois(nextCois);
        saveCOIsMutation.mutate(nextCois);
      }
    }

    // Bid packages + their dependent bids. Bids key off packageId, so first
    // collect the doomed package ids for this project, then drop both.
    {
      const nextPackages = bidPackages.filter(p => !ids.has(p.projectId));
      if (nextPackages.length !== bidPackages.length) {
        const doomedPackageIds = new Set(
          bidPackages.filter(p => ids.has(p.projectId)).map(p => p.id),
        );
        setBidPackages(nextPackages);
        saveBidPackagesMutation.mutate(nextPackages);
        const nextBids = bidPackageBids.filter(b => !doomedPackageIds.has(b.packageId));
        if (nextBids.length !== bidPackageBids.length) {
          setBidPackageBids(nextBids);
          saveBidPackageBidsMutation.mutate(nextBids);
        }
      }
    }

    // --- collections persisted via a persistX helper (does its own setState) ---
    cascadePersist(warranties, persistWarranties);
    cascadePersist(portalMessages, persistPortalMessages);
    cascadePersist(permitRoadmaps, persistPermitRoadmaps);

    // Plan collections: parent sheets + every sheet-linked sub-collection. Each
    // sub-collection carries its own projectId, so filter directly.
    cascadePersist(planSheets, persistPlanSheets);
    cascadePersist(drawingPins, persistDrawingPins);
    cascadePersist(planZones, persistPlanZones);
    cascadePersist(planReviews, persistPlanReviews);
    cascadePersist(planMarkups, persistPlanMarkups);
    cascadePersist(planCalibrations, persistPlanCalibrations);

    // Surface each EXACT id to provider-siblings that own their own
    // project-scoped collections and cannot see this cascade (SafetyContext).
    // The signal carries one id per render, so a batch (a load that found two
    // jobs he was removed from) is spread over separate ticks — one render
    // each — instead of letting React batch all but the last one away.
    const list = [...ids];
    setProjectDeletion(prev => ({ deletedProjectId: list[0], tick: prev.tick + 1 }));
    list.slice(1).forEach((pid, i) => {
      setTimeout(() => setProjectDeletion(prev => ({ deletedProjectId: pid, tick: prev.tick + 1 })), (i + 1) * 16);
    });
  }, [

    changeOrders, saveChangeOrdersMutation,
    invoices, saveInvoicesMutation,
    commitments, saveCommitmentsMutation,
    dailyReports, saveDailyReportsMutation,
    fieldTickets, saveFieldTicketsMutation,
    delayEvents, saveDelayEventsMutation,
    deliveries, saveDeliveriesMutation,
    buildingAccessRules, saveBuildingAccessMutation,
    accessReservations, saveReservationsMutation,
    deliveryReceipts, saveDeliveryReceiptsMutation,
    punchItems, savePunchItemsMutation,
    projectPhotos, savePhotosMutation,
    rfis, saveRfisMutation,
    submittals, saveSubmittalsMutation,
    oacMeetings, saveOACMeetingsMutation,
    permits, savePermitsMutation,
    aiaPayApps, saveAiaPayAppsMutation,
    subPortalLinks, saveSubPortalLinksMutation,
    commEvents, saveCommEventsMutation,
    cois, saveCOIsMutation,
    bidPackages, saveBidPackagesMutation,
    bidPackageBids, saveBidPackageBidsMutation,
    warranties, persistWarranties,
    portalMessages, persistPortalMessages,
    permitRoadmaps, persistPermitRoadmaps,
    planSheets, persistPlanSheets,
    drawingPins, persistDrawingPins,
    planZones, persistPlanZones,
    planReviews, persistPlanReviews,
    planMarkups, persistPlanMarkups,
    planCalibrations, persistPlanCalibrations,
  ]);

  // The latest cascade, for a delete that finished its safety check a few
  // hundred ms after the render it closed over (see deleteProject).
  const forgetProjectsLocallyRef = useRef(forgetProjectsLocally);
  forgetProjectsLocallyRef.current = forgetProjectsLocally;
  dropLocalOnlyJobsRef.current = (ids: ReadonlySet<string>) => {
    if (ids.size === 0) return;
    const next = projectsRef.current.filter(p => !ids.has(p.id));
    if (next.length === projectsRef.current.length) return;
    projectsRef.current = next;
    setProjects(next);
    saveProjectsMutation.mutate(next);
    forgetProjectsLocallyRef.current(ids);
  };

  // #61 (wave 5, CONTRACT 22) · How many injury / near-miss records the job
  // has, as best this device can know BEFORE anything is removed — null when
  // it cannot tell (the server could not be asked). The device's own incidents
  // first (SafetyContext's per-account cache — the literal key is repeated
  // because SafetyProvider sits BELOW this provider — plus incident inserts
  // still queued: one filed in a basement is on no server yet). Only a job the
  // server has confirmed is asked about; one that never reached it can hold no
  // server-side incident.
  const safetyIncidentCountForDelete = async (projectId: string): Promise<number | null> => {
    let local = 0;
    try {
      const [cached, queue] = await Promise.all([
        loadLocal<{ id?: string; projectId?: string }[]>(`mageid_safety_incidents_${userId ?? 'anon'}`, []),
        getOwnOfflineQueue().catch(() => []),
      ]);
      local = localSafetyIncidentCount(projectId, cached, queue);
    } catch { local = 0; }
    if (local > 0) return local;
    if (!canSync) return 0; // signed out: the job is this device's alone
    await seedServerProjectIds();
    if (!serverProjectIdsRef.current.has(projectId)) return 0;
    try {
      const head = supabase.from('safety_incidents').select('id', { count: 'exact', head: true }).eq('project_id', projectId);
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000));
      const res = await Promise.race([head, timeout]);
      if (!res || res.error || typeof res.count !== 'number') return null;
      return res.count;
    } catch {
      return null;
    }
  };

  const deleteProject = useCallback(async (id: string, opts?: { safetyIncidentCount?: number }): Promise<DeleteProjectResult> => {
    const toDelete = projects.find(p => p.id === id);
    // #92: only the owner deletes. For anyone else RLS matches 0 rows and the
    // queue calls that done, while the cascade below had already wiped every
    // child record of the job from his phone until the next load brought it
    // back. Refused BEFORE anything local is touched; the UI offers Leave.
    const refusal = deleteProjectRefusal(toDelete, userId);
    if (refusal) return { ok: false, reason: refusal };

    // #61 (wave 5, CONTRACT 22): a job with injury / near-miss records keeps
    // them — OSHA says 5 years, and the delete cascaded them away. Checked
    // BEFORE anything local changes too: the caller's count (project-detail
    // reads useSafety()) or, without one, what this device and the server
    // know. A job that cannot be checked waits. The server refuses the delete
    // as well (23001), and the queue puts the job back if one slips through.
    let fresh = true;
    if (toDelete) {
      let count: number | null | undefined = opts?.safetyIncidentCount;
      if (count === undefined) {
        count = await safetyIncidentCountForDelete(id);
        fresh = false;
        if (count === null) return { ok: false, reason: SAFETY_CHECK_OFFLINE_REASON };
      }
      const safety = deleteProjectSafetyRefusal(toDelete.name, count);
      if (safety) return { ok: false, reason: safety, action: DELETE_SAFETY_ACTION };
    }

    // 1) Remove the project row — from the LATEST list: the check above may
    //    have awaited, and this render's list can be a write behind.
    const updatedProjects = (fresh ? projects : projectsRef.current).filter(p => p.id !== id);
    projectsRef.current = updatedProjects;
    setProjects(updatedProjects);
    saveProjectsMutation.mutate(updatedProjects);

    // 2) Every project-scoped child collection, and the signal provider-
    //    siblings (SafetyContext) prune on — see forgetProjectsLocally. After
    //    an await, the latest render's cascade (its lists are current).
    if (!fresh) forgetProjectsLocallyRef.current(new Set([id]));
    else forgetProjectsLocally(new Set([id]));

    // 3) Server: parent delete (children fall to FK cascade — see note above).
    if (toDelete) syncProjectToSupabase(toDelete, 'delete');

    return { ok: true };
  // safetyIncidentCountForDelete reads refs and module functions; seeded
  // server ids through seedServerProjectIds.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, projects, saveProjectsMutation, syncProjectToSupabase, forgetProjectsLocally, canSync, seedServerProjectIds]);

  // Review round 1: the lists read at cleanup time are not enough. On a cold
  // launch the projects load can land before the child lists hydrate, so the
  // record → job map (the only tie a queued UPDATE has to its job) is built
  // from the device caches as well, and a list that hydrates LATER with a
  // removed job's records is swept again (the effect below) — its orphans
  // leave, and any queued write the late list reveals is dropped too.
  const REVOKED_SWEEP_CACHE_KEYS = [
    CHANGE_ORDERS_KEY, INVOICES_KEY, COMMITMENTS_KEY, DAILY_REPORTS_KEY, FIELD_TICKETS_KEY, PUNCH_ITEMS_KEY, PHOTOS_KEY,
    RFIS_KEY, SUBMITTALS_KEY, PERMITS_KEY, AIA_PAY_APPS_KEY, WARRANTIES_KEY, PLAN_SHEETS_KEY, DRAWING_PINS_KEY,
    PLAN_MARKUPS_KEY, PLAN_CALIBRATIONS_KEY, OAC_MEETINGS_KEY, DELAY_EVENTS_KEY, DELIVERIES_KEY,
  ] as const;
  const revokedSweepLists = [
    changeOrders, invoices, commitments, dailyReports, fieldTickets, punchItems, projectPhotos, rfis, submittals, permits,
    aiaPayApps, warranties, planSheets, drawingPins, planMarkups, planCalibrations, oacMeetings, delayEvents, deliveries,
  ] as readonly (readonly { id?: string; projectId?: string }[])[];
  // The latest render's lists, for the stable countQueuedForProject.
  const revokedSweepListsRef = useRef(revokedSweepLists);
  revokedSweepListsRef.current = revokedSweepLists;
  // Record id → job for `ids`, from the given in-memory lists AND the device
  // caches (see above) — the one map both the sweep and the count use, so
  // "N changes would be discarded" is exactly what the sweep discards.
  const childProjectMapFromListsAndCaches = async (
    memory: readonly (readonly { id?: string; projectId?: string }[])[],
    ids: ReadonlySet<string>,
  ): Promise<Map<string, string>> => {
    const disk = await Promise.all(REVOKED_SWEEP_CACHE_KEYS.map(k =>
      loadLocal<{ id?: string; projectId?: string }[]>(k, []).catch(() => [])));
    return childProjectMap([...memory, ...disk], ids);
  };
  const sweepRevokedJobs = (ids: ReadonlySet<string>, names: ReadonlyMap<string, string>): Promise<number> => {
    // Synchronously first: forgetProjectsLocally cascades THIS render's lists.
    const memory = revokedSweepLists;
    forgetProjectsLocally(ids);
    const reasonFor = (pid: string) => (leftByMeRef.current.has(pid)
      ? `You left ${(names.get(pid) ?? '').trim() || 'this job'}, so this change was not sent`
      : noLongerHaveAccessReason(names.get(pid)));
    return (async () => {
      const childProject = await childProjectMapFromListsAndCaches(memory, ids);
      const writes = await discardQueuedWrites((m) => {
        const pid = queuedEntryRevokedProject(m, ids, childProject);
        return pid ? reasonFor(pid) : null;
      });
      // Integration round 2: and the job's lines already under Not saved
      // (refused, dropped by a flush, or parked there — the pre-leave flush
      // itself parks queued writes behind an unsaved one). They stayed
      // Retry-able forever, every tap refused under RLS with "you do not have
      // permission". Turned into notes with the same sentence, the way the
      // queued ones above are; counted with them.
      let unsaved = 0;
      try {
        unsaved = await noteUnsavedWrites((f) => {
          const e = ledgerLineAsQueueEntry(f);
          const pid = e ? queuedEntryRevokedProject(e, ids, childProject) : null;
          return pid ? reasonFor(pid) : null;
        });
      } catch (err) {
        console.log('[ProjectContext] Noting unsaved writes for a revoked job failed:', err);
      }
      // #8/#128 (wave 4): the job's queued PHOTOS too. They were left in the
      // photo queue, where every upload was refused under Storage RLS and
      // surfaced a day later as a generic "couldn't be uploaded". Dropped with
      // the same sentence, recorded and reported like the writes.
      let photos = 0;
      try {
        photos = await discardQueuedPhotoUploads((t) => (t.projectId && ids.has(t.projectId) ? reasonFor(t.projectId) : null));
      } catch (err) {
        console.log('[ProjectContext] Dropping queued photos for a revoked job failed:', err);
      }
      return writes + unsaved + photos;
    })();
  };
  // #8/#128 (wave 4) · How many of THIS session's changes to one job have not
  // reached the server: queued writes (the same matcher and record → job map
  // the leave sweep discards by — utils/projectContextPure
  // countQueuedEntriesForProject), its Not-saved lines, plus queued photo uploads. "Leave project"
  // states it before he confirms, instead of promising nothing is lost.
  const countQueuedForProject = useCallback(async (projectId: string): Promise<number> => {
    if (!projectId) return 0;
    const ids = new Set([projectId]);
    const [queue, unsaved, childProject, photos] = await Promise.all([
      getOwnOfflineQueue(),
      // Integration round 2: the job's Not-saved lines too. The pre-leave
      // flush can itself PARK queued writes into the ledger (a record with an
      // unsaved write), which LOWERED this count — the dialog then said
      // nothing was pending while the sweep left those lines behind.
      ownUnsavedWrites().catch(() => []),
      childProjectMapFromListsAndCaches(revokedSweepListsRef.current, ids),
      countQueuedPhotoUploadsForProject(projectId).catch(() => 0),
    ]);
    const unsavedEntries = unsaved.map(ledgerLineAsQueueEntry).filter((e): e is NonNullable<typeof e> => e !== null);
    return countQueuedEntriesForProject(queue, projectId, childProject)
      + countQueuedEntriesForProject(unsavedEntries, projectId, childProject) + photos;
  // Refs and module functions only — stable for the context's stable bucket.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Integration round 3 · The Not-saved part of that count, by the same
  // matcher and map. "Sync first" re-runs the flush, which never sends a
  // ledger line: with only these left the dialog came back with the same
  // number on every tap. project-detail names them and opens the sheet.
  const countUnsavedForProject = useCallback(async (projectId: string): Promise<number> => {
    if (!projectId) return 0;
    const ids = new Set([projectId]);
    const [unsaved, childProject] = await Promise.all([
      ownUnsavedWrites().catch(() => []),
      childProjectMapFromListsAndCaches(revokedSweepListsRef.current, ids),
    ]);
    const unsavedEntries = unsaved.map(ledgerLineAsQueueEntry).filter((e): e is NonNullable<typeof e> => e !== null);
    return countQueuedEntriesForProject(unsavedEntries, projectId, childProject);
  // Refs and module functions only — stable for the context's stable bucket.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const forgetSharedProject = useCallback((id: string): { ok: true; dropped?: Promise<number> } | { ok: false; reason: string } => {
    const p = projectsRef.current.find(x => x.id === id);
    if (!p) return { ok: true, dropped: Promise.resolve(0) };
    // His own job (or one with no owner stamp — his unsynced create) is never
    // "left": that is a delete, with its server write.
    if (!p.ownerUserId || p.ownerUserId === userId) {
      return { ok: false, reason: 'This is your job, so you cannot leave it — delete it instead.' };
    }
    leftByMeRef.current.add(id);
    revokedSweepRef.current.set(id, p.name ?? '');
    const next = projectsRef.current.filter(x => x.id !== id);
    projectsRef.current = next;
    setProjects(next);
    saveProjectsMutation.mutate(next);
    // #8/#128 (wave 4): the count comes back, so the "You left" alert can say
    // how many unsent changes went with the job (it is never silent).
    const dropped = sweepRevokedJobs(new Set([id]), new Map([[id, p.name ?? '']]))
      .catch((err) => { console.log('[ProjectContext] Dropping queued writes for a left job failed:', err); return 0; });
    return { ok: true, dropped };
  // The child lists are read at call time; forgetProjectsLocally carries them.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, saveProjectsMutation, forgetProjectsLocally]);

  // #90 · The one-time cleanup for jobs the projects load found he was
  // removed from (the loader and hydration pass already took the rows out of
  // the list). Their child records leave this phone the way a delete's do,
  // minus the server write; every write still queued for them goes to the
  // failure path with the job's name — RLS would refuse each one on the next
  // flush and the generic toast could only name a table; and he is told once
  // why the job left, instead of watching it vanish.
  useEffect(() => {
    if (!revokedCleanup || revokedCleanup.size === 0) return;
    const names = revokedCleanup;
    setRevokedCleanup(null);
    for (const [pid, name] of names) revokedSweepRef.current.set(pid, name);
    const ids = new Set(names.keys());
    const toldIds = [...ids].filter(pid => !leftByMeRef.current.has(pid));
    const jobs = toldIds.map(pid => (names.get(pid) ?? '').trim()).filter(Boolean);
    const which = jobs.length === 0 ? (toldIds.length === 1 ? 'a job' : `${toldIds.length} jobs`) : jobs.join(', ');
    // The copy names every way it can happen, not a guess: leftByMeRef knows
    // only THIS device's Leave, so on his other devices a job he left himself
    // arrives here too — and the server does not tell the loader who ended
    // the membership.
    const tell = (unsent: number) => toldIds.length > 0 && showAlert(
      'No longer on a job',
      `You no longer have access to ${which} — you left it, its owner removed you, or it was deleted — so it has left this phone.`
        + (unsent > 0 ? ` ${unsent} change${unsent === 1 ? '' : 's'} you had not synced for it could not be sent.` : ''),
    );
    sweepRevokedJobs(ids, names).then(tell, (err) => {
      console.log('[ProjectContext] Dropping queued writes for a removed job failed:', err);
      tell(0);
    });
  // The sweep reads this render's lists; the late-hydration effect below
  // covers lists that arrive after it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revokedCleanup]);
  // A child list that hydrated after the sweep (cold launch) and still holds
  // a removed job's records: sweep again. Silent — he was told once.
  useEffect(() => {
    const swept = revokedSweepRef.current;
    if (swept.size === 0) return;
    const ids = new Set(swept.keys());
    if (!listsHoldRevoked(revokedSweepLists, ids)) return;
    sweepRevokedJobs(ids, new Map(swept)).catch((err) => {
      console.log('[ProjectContext] Re-sweeping a removed job failed:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, revokedSweepLists as unknown[]);

  // ─── #23 · The homeowner portal follows his records, wherever he edits ───
  // The portal reads only portal_snapshots, and the lite rebuild ran only in
  // project-detail's effect — so a daily report, homeowner update, invoice, CO,
  // punch item or photo made from Home, the Create menu or the invoices screen
  // reached the client only when he next opened that project. This publishes
  // every OWNED portal-enabled project THIS DEVICE CHANGED, through the same
  // utils/portalLiteSync function project-detail calls (one run per project,
  // no no-op writes, owner-only, never from a default profile, never after a
  // failed read), and every owned portal once after load.
  //
  // WHAT THIS DEVICE WROTE (portalDirtyRef, marked by the tracked save
  // mutations, persistWarranties and the settings writers), plus — #17, wave
  // 4 — what ANOTHER member of the job shared that SERVER reads brought in
  // (a foreman's daily report and photos: his device may not publish, and the
  // overlay only removes). Any other refetch is no reason to publish: a change
  // he made himself on another device is published by that device. And
  // requestPortalPublish, for what the publish reads only at publish time
  // (the contract). But a publish from HERE rebuilds every section from this
  // device's lists, so it may only use lists read since the latest return to
  // the foreground (the epoch gate below, #23 round 2) — otherwise the 07:00
  // copies would pull what the web shared at 18:00 off the portal (#44).
  // WHAT THIS GIVES UP: after every return to the foreground (at most one per
  // 30 s — useProjectsFocusRefetch's gap), nothing publishes until all nine
  // lists (and the AIA pay applications, #15) have answered again; a change
  // made in that window is published
  // once they have (the marks wait). Within the 30 s gap a quick background /
  // foreground re-reads nothing, so the lists can be up to that much older
  // than the foreground. A list whose re-read fails keeps publishing off
  // until a later read of it succeeds (next foreground, Retry, queue flush).
  //
  // DEBOUNCED, NEVER DROPPED. Each change restarts a short timer; the inputs
  // are read from the latest render when it fires, so the last change is the
  // one published. A project is marked done only on an outcome that settles
  // it — a failed read or write, or a run folded into one already in flight,
  // is tried again on the next pass. A steady stream of changes cannot starve
  // it: the first change waits at most PORTAL_SYNC_MAX_WAIT_MS.
  //
  // NOT BEFORE EVERY LIST HAS LOADED. A missing section is "gone" to the
  // portal (#44), so a publish from a half-loaded device would pull the
  // client's invoices or reports off the page.
  const portalSyncReady = canSync && projectsLoaded && settingsLoaded
    && changeOrdersLoaded && dailyReportsLoaded && photosLoaded
    && invoicesQuery.isFetched && punchItemsQuery.isFetched && rfisQuery.isFetched && permitsQuery.isFetched
    && warrantiesLoadedFor === (userId ?? '')
    // …AND EVERY ONE OF THEM CAME FROM THE SERVER, IN THIS FOREGROUND EPOCH.
    // A loader whose read failed (or whose empty answer was not trusted) falls
    // back to the device cache and still reads "loaded"; publishing that pulls
    // whatever the cache lacks off the homeowner's portal. The marks wait
    // (nothing settles) until a later read of that list succeeds — the next
    // foreground (which re-reads all nine), the user's Retry, a queue flush.
    // WHAT THIS GIVES UP: while any one list cannot be read, neither this
    // provider nor project-detail publishes, even for a change this device
    // made — the portal stays on its last good snapshot rather than a partial
    // one.
    && portalListsFromServer(portalServerReads, userId);
  // The same answer at publish time: a read that fell back after the timer
  // was set — or a return to the foreground since (refetchAllOnForeground
  // drops the ref at once) — must stop that pass too (the marks stay for the
  // next one).
  const portalListsServerRead = portalListsFromServer(portalServerReads, userId);
  portalListsServerRef.current = portalListsServerRead;
  // #15 (wave 4) · …and the AIA pay applications, which the lite writer now
  // builds FRESH from the list it is handed (an absent list is carried). The
  // provider hands it over, so it waits for that list's server read in this
  // epoch as well — a pass holds (marks kept) until it has answered.
  const portalAiaFresh = portalSideListFresh(portalServerReads, 'aiaPayApps', userId);
  portalAiaFreshRef.current = portalAiaFresh;
  // `epoch` (#21, wave 4): the foreground epoch these lists were read in. A
  // pass compares it with portalReadEpochRef at every step and stops, settling
  // nothing, once the phone has come back to the foreground since.
  const portalSyncLatestRef = useRef<Omit<PortalLiteSyncInput, 'project'> & { projects: Project[]; epoch: number } | null>(null);
  const portalSyncSigRef = useRef<Map<string, string>>(new Map());
  const portalSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portalSyncFirstPendingAtRef = useRef<number | null>(null);
  const portalSyncRunningRef = useRef(false);
  const portalSyncAgainRef = useRef(false);
  const publishOwnedPortals = useCallback(async (): Promise<void> => {
    if (portalSyncRunningRef.current) { portalSyncAgainRef.current = true; return; }
    portalSyncRunningRef.current = true;
    // ONE ITERATION. Every stop inside it (a list fell back to the cache, the
    // epoch moved, the account changed) `return`s from THIS function only —
    // the loop below then honours a publishOwnedPortals call folded in while
    // it was awaiting (portalSyncAgainRef), with the latest inputs. When the
    // stops returned from the whole pass, a folded call was dropped: the fresh
    // lists' pass after a foreground was folded, the stale pass returned, and
    // every waiting mark ('*', a #17 arrival, a requestPortalPublish) sat
    // unpublished until some unrelated change (wave 4 review of #21).
    const runPass = async (): Promise<void> => {
      const inp = portalSyncLatestRef.current;
      const uid = inp?.userId;
      if (!inp || !uid) return;
      // #21 (wave 4): the epoch THIS iteration's lists were read in. A pass
      // still running when the phone comes back to the foreground used to
      // finish on the pre-lock lists — the per-project flag check below only
      // caught a foreground whose re-reads were still out — and settle those
      // jobs, so the fresh lists never republished them and whatever was
      // shared from another device while the phone slept left the portal.
      const passEpoch = inp.epoch;
      const epochMoved = () => portalReadEpochRef.current !== passEpoch;
      if (!portalListsServerRef.current || epochMoved()) return; // #23: a list is the cache's — publish nothing, settle nothing
      if (!portalAiaFreshRef.current) return; // #15: the AIA list is not the server's yet — same rule
      // The marks this pass answers. One made while it runs has a newer
      // number and survives (the effect runs another pass for it).
      const marks = new Map(portalDirtyRef.current);
      const allMark = marks.get('*');
      let allSettled = true;
      const settle = (id: string) => {
        const seen = marks.get(id);
        if (seen != null && portalDirtyRef.current.get(id) === seen) portalDirtyRef.current.delete(id);
      };
      for (const project of inp.projects) {
        if (liveUserIdRef.current !== uid) return;
        if (allMark == null && !marks.has(project.id)) continue;
        if (!project.clientPortal?.enabled || !isPortalOwner(project, uid)) { settle(project.id); continue; }
        // #15: the AIA list is handed over (server-read, gated above), so
        // the pay-app section is built fresh — a sent pay app appears, a
        // recalled one leaves — and it is part of the signature, so a pay
        // app's portal state moving counts as a change.
        const input: PortalLiteSyncInput = {
          project, userId: uid, settings: inp.settings, settingsLoaded: inp.settingsLoaded,
          invoices: inp.invoices, changeOrders: inp.changeOrders, dailyReports: inp.dailyReports,
          punchItems: inp.punchItems, photos: inp.photos, rfis: inp.rfis, warranties: inp.warranties,
          permits: inp.permits, aiaPayApps: inp.aiaPayApps,
        };
        const sig = portalLiteSignature(project.id, {
          project, settings: inp.settings,
          lists: {
            invoices: inp.invoices, changeOrders: inp.changeOrders, dailyReports: inp.dailyReports,
            punchItems: inp.punchItems, photos: inp.photos, rfis: inp.rfis, warranties: inp.warranties,
            permits: inp.permits, aiaPayApps: inp.aiaPayApps ?? [],
          },
        });
        if (portalSyncSigRef.current.get(project.id) === sig) { settle(project.id); continue; }
        // Re-checked per project: a return to the foreground mid-pass makes
        // `inp` older than the latest foreground — stop, settle nothing.
        if (!portalListsServerRef.current || epochMoved() || !portalAiaFreshRef.current) return;
        const outcome = await syncPortalSnapshotLite(project.id, input);
        if (liveUserIdRef.current !== uid) return;
        // #21: the phone came back to the foreground while this job's publish
        // was out — it went out from the pre-lock lists. Record nothing and
        // settle nothing (drop any signature, so an equal-looking fresh one
        // cannot skip it): the fresh lists' pass republishes this job.
        if (epochMoved()) { portalSyncSigRef.current.delete(project.id); return; }
        if (portalLiteOutcomeSettles(outcome)) {
          // #12/#65 (wave 4 review): the signature is built from the LISTS,
          // not from what the publish reads at publish time (the contract,
          // selections, the binder). A requestPortalPublish made while this
          // job's publish was out dropped the signature and re-marked the
          // job — writing it back here made the next pass see an equal
          // signature, settle the new mark and publish nothing (the draft
          // contract stayed while the homeowner was emailed "review & sign").
          // So the signature is recorded only if the job's mark did not move
          // during the publish; if it did, none is kept and the next pass
          // republishes it. settle() already leaves a newer mark in place.
          if (portalDirtyRef.current.get(project.id) === marks.get(project.id)) portalSyncSigRef.current.set(project.id, sig);
          else portalSyncSigRef.current.delete(project.id);
          settle(project.id);
        } else {
          allSettled = false;
          console.log('[portal-sync] not settled for', project.id, outcome);
        }
      }
      // #21: nor are marks cleared from lists an older epoch read.
      if (epochMoved()) return;
      // Marks for projects no longer on his list answer nothing.
      const listed = new Set(inp.projects.map(p => p.id));
      for (const id of [...portalDirtyRef.current.keys()]) if (id !== '*' && !listed.has(id) && marks.has(id)) settle(id);
      if (allMark != null && allSettled && portalDirtyRef.current.get('*') === allMark) portalDirtyRef.current.delete('*');
    };
    try {
      do {
        portalSyncAgainRef.current = false;
        await runPass();
      } while (portalSyncAgainRef.current);
    } finally {
      portalSyncRunningRef.current = false;
    }
  }, []);
  // A new account starts with nothing published by this device.
  useEffect(() => {
    portalSyncSigRef.current = new Map();
    // …and owes every owned portal one publish once its lists have loaded.
    portalDirtySeqRef.current += 1;
    portalDirtyRef.current = new Map([['*', portalDirtySeqRef.current]]);
    portalSyncLatestRef.current = null;
    portalSyncFirstPendingAtRef.current = null;
    if (portalSyncTimerRef.current) { clearTimeout(portalSyncTimerRef.current); portalSyncTimerRef.current = null; }
  }, [userId]);
  // The debounced pass itself (refs only, so it is stable): the timer restarts
  // on every call, but the first pending change never waits past the max.
  const schedulePortalPass = useCallback(() => {
    const now = Date.now();
    if (portalSyncFirstPendingAtRef.current == null) portalSyncFirstPendingAtRef.current = now;
    const waited = now - portalSyncFirstPendingAtRef.current;
    const delay = Math.max(0, Math.min(PORTAL_SYNC_DEBOUNCE_MS, PORTAL_SYNC_MAX_WAIT_MS - waited));
    if (portalSyncTimerRef.current) clearTimeout(portalSyncTimerRef.current);
    portalSyncTimerRef.current = setTimeout(() => {
      portalSyncTimerRef.current = null;
      portalSyncFirstPendingAtRef.current = null;
      void publishOwnedPortals();
    }, delay);
  }, [publishOwnedPortals]);
  useEffect(() => {
    if (!portalSyncReady || !portalAiaFresh) return;
    const prevInp = portalSyncLatestRef.current;
    // #17 (wave 4) · A shared record ANOTHER member of the job filed — an
    // editor-seat foreman's daily report or photos — reached the homeowner
    // only when the GC edited that job himself: his device cannot publish
    // (not_owner) and the portal overlay only removes. The lists here are all
    // SERVER reads of the current epoch (the gate above), so comparing them
    // with what the last pass saw finds exactly what arrived from others, and
    // marks those owned portal jobs (the signature check keeps a no-op free).
    if (prevInp && userId && prevInp.userId === userId) {
      const owned = new Set(projects.filter(p => p.clientPortal?.enabled && isPortalOwner(p, userId)).map(p => p.id));
      if (owned.size > 0) {
        markPortalDirty(portalArrivalProjectIds(prevInp.dailyReports, dailyReports, {
          viewerId: userId, ownedPortalProjectIds: owned, authorOf: r => r.filedByUserId, fingerprint: portalContentFingerprint,
        }));
        markPortalDirty(portalArrivalProjectIds(prevInp.photos, projectPhotos, {
          viewerId: userId, ownedPortalProjectIds: owned, authorOf: r => r.userId, fingerprint: portalContentFingerprint,
        }));
      }
    }
    portalSyncLatestRef.current = {
      userId, settings, settingsLoaded, projects,
      invoices, changeOrders, dailyReports, punchItems, photos: projectPhotos, rfis, warranties, permits,
      aiaPayApps, epoch: portalServerReads.epoch,
    };
    schedulePortalPass();
  }, [portalSyncReady, portalAiaFresh, portalServerReads.epoch, userId, settings, settingsLoaded, projects, invoices, changeOrders, dailyReports, punchItems, projectPhotos, rfis, warranties, permits, aiaPayApps, schedulePortalPass, markPortalDirty]);
  // #12/#65 (wave 4) · A republish for what the pass reads only at publish
  // time — the contract (Sign & send on a job already in progress changed no
  // list here, so the homeowner was emailed "review & sign in your portal"
  // and found no contract), selections, the closeout binder. The stored
  // signature is dropped (it is built from the lists, so an unchanged one
  // would settle the mark without publishing) and the job marked; the pass
  // still waits for server lists of the current foreground, and an owner
  // device is the only one that publishes. No lists yet → the mark waits for
  // the first pass the readiness effect runs.
  const requestPortalPublish = useCallback((projectId: string) => {
    if (!projectId) return;
    portalSyncSigRef.current.delete(projectId);
    markPortalDirty([projectId]);
    if (portalSyncLatestRef.current) schedulePortalPass();
  }, [markPortalDirty, schedulePortalPass]);
  useEffect(() => () => {
    if (portalSyncTimerRef.current) clearTimeout(portalSyncTimerRef.current);
  }, []);

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [projects]);

  // RT-R1 retry. Every query this provider owns is keyed `[table, userId]`, so
  // a predicate catches all of them without a hand-maintained list that goes
  // stale the next time a table is added here. The probe is refetched too, so
  // a successful retry clears the "couldn't reach MAGE" row that offered it.
  // The predicate deliberately also sweeps the handful of sibling per-user
  // queries in that shape (crew_members, notificationFeed, accountSeats…):
  // this is a user-tapped "retry everything", not a targeted invalidation,
  // and those reads failed for the same reason the ones here did.
  const retryRemoteReads = useCallback(() => {
    void queryClient.refetchQueries({ queryKey: MAGE_REACHABILITY_QUERY_KEY });
    if (!userId) return;
    void (async () => {
      // Finding 105: with no settings loaded, the query has no data, and
      // React Query's invalidate does NOT cancel a data-less query — it joins
      // the running retry cycle, so a Retry pressed on a stalled first read
      // did nothing. Cancel it first so the Retry really starts a new read.
      // (Safe for the splash: settingsHoldsBoot is sticky per account, so the
      // restarted read cannot put the CraneLoader back over the app.)
      if (settingsLoadedForRef.current !== userId) {
        try { await queryClient.cancelQueries({ queryKey: ['settings', userId] }); } catch { /* nothing to cancel */ }
      }
      // Warranties is not a query (#23 round 2): without this its portal
      // stamp, cleared by a failed launch read, never came back.
      setWarrantiesReload(n => n + 1);
      await queryClient.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.length === 2 && q.queryKey[1] === userId,
      });
    })();
  }, [queryClient, userId]);

  // ── Bucket memos ─────────────────────────────────────────────────────────────
  const coreData = useMemo<CoreDataValue>(() => ({
    projects: sortedProjects, settings, hasSeenOnboarding, userRole,
    isLoading: projectsQuery.isLoading || settingsBootLoading || onboardingQuery.isLoading || userRoleQuery.isLoading,
    projectsLoaded,
    settingsLoaded,
    settingsLoadFailed: !settingsLoaded && settingsLoadFailed,
    sourceFailed: reachability.failed,
    retryRemoteReads,
    portalListsServerRead,
    portalAiaListServerRead: portalAiaFresh,
    refreshAll,
    reloadLocalMirrors,
    projectsFetching: projectsQuery.isFetching,
    addProject, updateProject, deleteProject, forgetSharedProject, getProject, updateSettings, savePaymentTerms,
    addCollaborator, removeCollaborator,
    priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert,
    contacts, addContact, updateContact, deleteContact, getContact,
    commEvents, addCommEvent, getCommEventsForProject,
  }), [sortedProjects, settings, hasSeenOnboarding, userRole, projectsQuery.isLoading, projectsQuery.isFetching, settingsBootLoading, onboardingQuery.isLoading, userRoleQuery.isLoading, projectsLoaded, reachability.failed, retryRemoteReads, portalListsServerRead, portalAiaFresh, settingsLoaded, settingsLoadFailed, addProject, updateProject, deleteProject, forgetSharedProject, getProject, updateSettings, savePaymentTerms, addCollaborator, removeCollaborator, priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, contacts, addContact, updateContact, deleteContact, getContact, commEvents, addCommEvent, getCommEventsForProject, refreshAll, reloadLocalMirrors]);

  const financialsData = useMemo<FinancialsDataValue>(() => ({
    changeOrders, changeOrdersLoaded, invoicesLoaded, addChangeOrder, addChangeOrders, getChangeOrdersForProject,
    addInvoice, updateInvoice, awaitInvoiceInsert, getInvoicesForProject, getTotalOutstandingBalance, invoices,
    recordInvoicePayment,
    commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject,
    prequalPackets, upsertPrequalPacket, reviewPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken,
    aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject,
    delayEvents, addDelayEvent, updateDelayEvent, deleteDelayEvent, getDelayEventsForProject,
    deliveries, addDelivery, updateDelivery, deleteDelivery,
    buildingAccessRules, getBuildingAccess, setBuildingAccess,
    accessReservations, addReservation, updateReservation, deleteReservation,
    deliveryReceipts, addDeliveryReceipt, getReceiptsForProject,
  }), [changeOrders, changeOrdersLoaded, invoicesLoaded, addChangeOrder, addChangeOrders, getChangeOrdersForProject, addInvoice, updateInvoice, awaitInvoiceInsert, recordInvoicePayment, getInvoicesForProject, getTotalOutstandingBalance, invoices, commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject, prequalPackets, upsertPrequalPacket, reviewPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken, aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject, delayEvents, addDelayEvent, updateDelayEvent, deleteDelayEvent, getDelayEventsForProject, deliveries, addDelivery, updateDelivery, deleteDelivery, buildingAccessRules, getBuildingAccess, setBuildingAccess, accessReservations, addReservation, updateReservation, deleteReservation, deliveryReceipts, addDeliveryReceipt, getReceiptsForProject]);

  const fieldData = useMemo<FieldDataValue>(() => ({
    dailyReports, dailyReportsLoaded, getDailyReportsForProject,
    fieldTickets, addFieldTicket, updateFieldTicket, getFieldTicketsForProject,
    punchItems: punchItemsView, addPunchItem, addPunchItems, updatePunchItem, updatePunchItems, updatePunchItemPin, deletePunchItem, deletePunchItems, getPunchItemsForProject, punchItemsLoaded,
    projectPhotos, photosLoaded, addProjectPhoto, updateProjectPhoto, deleteProjectPhoto, getPhotosForProject,
    equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject,
    planSheets, planSheetsLoaded, addPlanSheet, addPlanSheets, updatePlanSheet, refetchPlansFromServer, deletePlanSheet, getPlanSheetsForProject, getPlanSheet,
    drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto,
    planZones, addPlanZone, updatePlanZone, deletePlanZone, getPlanZonesForPlan, getPlanZonesForProject,
    planReviews, getPlanReviewForSheet, savePlanReview, updatePlanReview, deletePlanReview,
    planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan,
    planCalibrations, upsertPlanCalibration, getCalibrationForPlan,
    permitRoadmaps, getPermitRoadmapForProject, savePermitRoadmap, updatePermitRoadmap, deletePermitRoadmap,
  }), [dailyReports, dailyReportsLoaded, getDailyReportsForProject, fieldTickets, addFieldTicket, updateFieldTicket, getFieldTicketsForProject, punchItemsView, addPunchItem, addPunchItems, updatePunchItem, updatePunchItems, updatePunchItemPin, deletePunchItem, deletePunchItems, getPunchItemsForProject, punchItemsLoaded, projectPhotos, photosLoaded, addProjectPhoto, updateProjectPhoto, deleteProjectPhoto, getPhotosForProject, equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject, planSheets, planSheetsLoaded, addPlanSheet, addPlanSheets, updatePlanSheet, refetchPlansFromServer, deletePlanSheet, getPlanSheetsForProject, getPlanSheet, drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto, planZones, addPlanZone, updatePlanZone, deletePlanZone, getPlanZonesForPlan, getPlanZonesForProject, persistPlanZones, planReviews, getPlanReviewForSheet, savePlanReview, updatePlanReview, deletePlanReview, persistPlanReviews, planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan, planCalibrations, upsertPlanCalibration, getCalibrationForPlan, permitRoadmaps, getPermitRoadmapForProject, savePermitRoadmap, updatePermitRoadmap, deletePermitRoadmap, persistPermitRoadmaps]);

  const preconData = useMemo<PreconDataValue>(() => ({
    subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor,
    leads, addLead, updateLead, deleteLead, getLead, leadsLoaded, refreshLeads, getLeadsByStage, addLeadTouch,
    bidPackages, bidPackageBids,
    addBidPackage, updateBidPackage, deleteBidPackage, getBidPackagesForProject, getBidPackage,
    addBidPackageBid, updateBidPackageBid, deleteBidPackageBid, getBidsForPackage,
    cois, addCOI, updateCOI, deleteCOI, getCOIsForSub,
  }), [subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor, leads, addLead, updateLead, deleteLead, getLead, leadsLoaded, refreshLeads, getLeadsByStage, addLeadTouch, bidPackages, bidPackageBids, addBidPackage, updateBidPackage, deleteBidPackage, getBidPackagesForProject, getBidPackage, addBidPackageBid, updateBidPackageBid, deleteBidPackageBid, getBidsForPackage, cois, addCOI, updateCOI, deleteCOI, getCOIsForSub]);

  const docsData = useMemo<DocsDataValue>(() => ({
    rfis, addRFI, addRFIs, updateRFI, deleteRFI, getRFIsForProject,
    permits, addPermit, updatePermit, deletePermit, getPermitsForProject,
    subPortalLinks, subPortalLinksLoaded, upsertSubPortalLink, adoptSubPortalToken, deleteSubPortalLink, getSubPortalLinkFor, getSubPortalLinksForProject,
    submittals, addSubmittal, addSubmittals, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle,
    oacMeetings, addOACMeeting, updateOACMeeting, deleteOACMeeting, getOACMeetingsForProject,
    warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim,
    portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc,
  }), [rfis, addRFI, addRFIs, updateRFI, deleteRFI, getRFIsForProject, permits, addPermit, updatePermit, deletePermit, getPermitsForProject, subPortalLinks, subPortalLinksLoaded, upsertSubPortalLink, adoptSubPortalToken, deleteSubPortalLink, getSubPortalLinkFor, getSubPortalLinksForProject, submittals, addSubmittal, addSubmittals, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle, oacMeetings, addOACMeeting, updateOACMeeting, deleteOACMeeting, getOACMeetingsForProject, warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim, portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc]);

  const stableActions = useMemo<StableActionsValue>(() => ({
    completeOnboarding,
    setUserRole,
    flushPendingProjectSyncs,
    writePortalMessage,
    absorbServerSchedule,
    requestPortalPublish,
    refetchInvoicesNow,
    countQueuedForProject,
    countUnsavedForProject,
    isProjectSyncUnconfirmed,
    onProjectSyncSettled,
  }), [completeOnboarding, setUserRole, flushPendingProjectSyncs, writePortalMessage, absorbServerSchedule, requestPortalPublish, refetchInvoicesNow, countQueuedForProject, countUnsavedForProject, isProjectSyncUnconfirmed, onProjectSyncSettled]);

  // Non-destructive import (app/data-import.tsx). Merges records from a MAGE
  // export BY ID — never overwrites or deletes existing rows, so re-importing
  // the same file is a no-op and importing onto a populated account is safe.
  // One functional-safe state update + one persist per collection (the per-item
  // add* helpers capture a stale array in a batch loop, which would drop all
  // but the last), plus per-new-item Supabase sync so imported rows survive the
  // next remote refetch. Reuses the exact mappings from addContact /
  // addSubcontractor / syncProjectToSupabase. v1 covers projects + the two
  // "book of business" lists; child financial/field records follow once their
  // add* paths expose a batch-safe, id-preserving sync.
  const importData = useCallback((payload: { projects?: Project[]; contacts?: Contact[]; subcontractors?: Subcontractor[] }) => {
    const result = { projects: 0, contacts: 0, subcontractors: 0 };

    if (payload.projects?.length) {
      const have = new Set(projects.map(p => p.id));
      // A-1: a backup may come from another account — the importer owns the
      // rows it creates here (ownerUserId stamped, loader stamps dropped).
      const add = payload.projects.filter(p => p.id && !have.has(p.id)).map(p => claimProjectForUser(p, userId));
      if (add.length) {
        const merged = [...add, ...projects];
        setProjects(merged);
        saveProjectsMutation.mutate(merged);
        add.forEach(p => syncProjectToSupabase(p, 'upsert'));
        result.projects = add.length;
      }
    }

    if (payload.contacts?.length) {
      const have = new Set(contacts.map(c => c.id));
      const add = payload.contacts.filter(c => c.id && !have.has(c.id));
      if (add.length) {
        const merged = [...add, ...contacts];
        setContacts(merged);
        saveContactsMutation.mutate(merged);
        if (canSync) add.forEach(c => void supabaseWrite('contacts', 'insert', {
          id: c.id, user_id: userId, first_name: c.firstName, last_name: c.lastName,
          company_name: c.companyName, role: c.role, email: c.email,
          secondary_email: c.secondaryEmail, phone: c.phone, address: c.address,
          notes: c.notes, linked_project_ids: c.linkedProjectIds,
          created_at: c.createdAt, updated_at: c.updatedAt,
        }));
        result.contacts = add.length;
      }
    }

    if (payload.subcontractors?.length) {
      const have = new Set(subcontractors.map(s => s.id));
      const add = payload.subcontractors.filter(s => s.id && !have.has(s.id));
      if (add.length) {
        const merged = [...add, ...subcontractors];
        setSubcontractors(merged);
        saveSubsMutation.mutate(merged);
        if (canSync) add.forEach(s => void supabaseWrite('subcontractors', 'insert', {
          id: s.id, user_id: userId, company_name: s.companyName, contact_name: s.contactName,
          phone: s.phone, email: s.email, address: s.address, trade: s.trade,
          license_number: s.licenseNumber, license_expiry: s.licenseExpiry, coi_expiry: s.coiExpiry,
          w9_on_file: s.w9OnFile, bid_history: s.bidHistory, assigned_projects: s.assignedProjects,
          notes: s.notes, created_at: s.createdAt, updated_at: s.updatedAt,
          ...subcontractorExtraColumns(s),
        }));
        result.subcontractors = add.length;
      }
    }

    return result;
  }, [projects, contacts, subcontractors, saveProjectsMutation, saveContactsMutation, saveSubsMutation, syncProjectToSupabase, canSync, userId]);

  const crossDomain = useMemo<CrossDomainValue>(() => ({
    updateChangeOrder, addDailyReport, updateDailyReport, convertLeadToProject, awardBidPackage,
    sendToClientPortal, recallFromClientPortal, batchSendToClientPortal, importData,
  }), [updateChangeOrder, addDailyReport, updateDailyReport, convertLeadToProject, awardBidPackage, sendToClientPortal, recallFromClientPortal, batchSendToClientPortal, importData]);

  return (
    <StableActionsContext.Provider value={stableActions}>
      <ProjectDeletionContext.Provider value={projectDeletion}>
      <CrossDomainContext.Provider value={crossDomain}>
        <CoreDataContext.Provider value={coreData}>
          <FinancialsDataContext.Provider value={financialsData}>
            <FieldDataContext.Provider value={fieldData}>
              <PreconDataContext.Provider value={preconData}>
                <DocsDataContext.Provider value={docsData}>
                  {children}
                </DocsDataContext.Provider>
              </PreconDataContext.Provider>
            </FieldDataContext.Provider>
          </FinancialsDataContext.Provider>
        </CoreDataContext.Provider>
      </CrossDomainContext.Provider>
      </ProjectDeletionContext.Provider>
    </StableActionsContext.Provider>
  );
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  return <ProjectProviderInner>{children}</ProjectProviderInner>;
}

function useCtx<T>(c: React.Context<T | null>, name: string): T {
  const v = useContext(c);
  if (v === null) throw new Error(`${name} must be used within ProjectProvider`);
  return v;
}

export function useProjects() {
  return {
    ...useCtx(CoreDataContext, 'CoreDataContext'),
    ...useCtx(FinancialsDataContext, 'FinancialsDataContext'),
    ...useCtx(FieldDataContext, 'FieldDataContext'),
    ...useCtx(PreconDataContext, 'PreconDataContext'),
    ...useCtx(DocsDataContext, 'DocsDataContext'),
    ...useCtx(StableActionsContext, 'StableActionsContext'),
    ...useCtx(CrossDomainContext, 'CrossDomainContext'),
  };
}

/** The deleted-project signal for provider-siblings that own their own
 *  project-scoped collections (SafetyContext). Subscribing here — rather than to
 *  useProjects() — means the subscriber only re-renders when a project is
 *  actually deleted, not on every unrelated CoreData change. */
export const useProjectDeletion = () => useCtx(ProjectDeletionContext, 'ProjectDeletionContext');

export const useCoreData = () => useCtx(CoreDataContext, 'CoreDataContext');
export const useFinancialsData = () => useCtx(FinancialsDataContext, 'FinancialsDataContext');
export const useFieldData = () => useCtx(FieldDataContext, 'FieldDataContext');
export const usePreconData = () => useCtx(PreconDataContext, 'PreconDataContext');
export const useDocsData = () => useCtx(DocsDataContext, 'DocsDataContext');
export const useProjectActions = () => useCtx(StableActionsContext, 'StableActionsContext');
export const useProjectCrossActions = () => useCtx(CrossDomainContext, 'CrossDomainContext');

/** #90 · What the device knows about his standing on a cached job — the
 *  server's owner stamp and the role the last projects load stamped — for
 *  hooks/useProjectRole. Tolerant (undefined outside the provider, or for a
 *  job not in the list) so the role hook can be mounted anywhere. */
export function useCachedProjectRoleHint(projectId: string | undefined): { ownerUserId?: string; myRole?: Project['myRole'] } | undefined {
  const core = useContext(CoreDataContext);
  const project = projectId && core ? core.projects.find(p => p.id === projectId) : undefined;
  // Primitives out, so a consumer's memo keyed on them does not churn with
  // every projects-list identity change.
  const ownerUserId = project?.ownerUserId;
  const myRole = project?.myRole;
  return useMemo(() => (project ? { ownerUserId, myRole } : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!project, ownerUserId, myRole]);
}
