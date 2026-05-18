# H5 Context Key Map — Authoritative useProjects() Key → Context Mapping

**Date:** 2026-05-18  
**Source:** `contexts/ProjectContext.tsx` (3,006 lines)  
**Method:** Read every `useCallback`/`useMemo` definition; recorded exact dep array; assigned bucket by data-domain coverage.

---

## Bucket Definitions

| Bucket | Data arrays "owned" |
|--------|-------------------|
| **CoreData** | `projects` (state), `settings`, `hasSeenOnboarding`, `contacts`, `commEvents`, `priceAlerts` |
| **FinancialsData** | `changeOrders`, `invoices`, `commitments`, `prequalPackets`, `aiaPayApps` |
| **FieldData** | `dailyReports`, `punchItems`, `projectPhotos`, `equipment`, `planSheets`, `drawingPins`, `planMarkups`, `planCalibrations` |
| **PreconData** | `leads`, `bidPackages`, `bidPackageBids`, `subcontractors`, `cois` |
| **DocsData** | `rfis`, `submittals`, `permits`, `warranties`, `oacMeetings`, `subPortalLinks`, `portalMessages` |
| **StableActions** | Functions whose dep arrays contain **no** domain data arrays (only: mutation objects, `userId`, `canSync`, stable helper callbacks) |
| **CrossDomain** | Functions whose (transitive, one level) deps span data arrays from ≥ 2 of the five data domains above |

---

## Complete Key Table (all 155 keys)

> **Dep array notation:** for DATA keys, the underlying state variable is listed. For FN keys, the exact `useCallback` or `useMemo` deps are listed (internal helpers that are not in the public API are noted by name; their own deps are noted one level deep where relevant to cross-domain classification).

| # | Key | Kind | Dep array (recorded) | Bucket |
|---|-----|------|---------------------|--------|
| 1 | `projects` | DATA | `sortedProjects` ← `useMemo([projects])` | CoreData |
| 2 | `settings` | DATA | `settings` state | CoreData |
| 3 | `hasSeenOnboarding` | DATA | `hasSeenOnboarding` state | CoreData |
| 4 | `isLoading` | DATA | `projectsQuery.isLoading \|\| settingsQuery.isLoading \|\| onboardingQuery.isLoading` | CoreData |
| 5 | `completeOnboarding` | FN | `[queryClient, userId, canSync]` | StableActions |
| 6 | `addProject` | FN | `[projects, saveProjectsMutation, syncProjectToSupabase, geocodeIfNeeded]` | CoreData |
| 7 | `updateProject` | FN | `[projects, saveProjectsMutation, syncProjectToSupabase, geocodeIfNeeded]` | CoreData |
| 8 | `deleteProject` | FN | `[projects, saveProjectsMutation, syncProjectToSupabase]` | CoreData |
| 9 | `getProject` | FN | `[projects]` | CoreData |
| 10 | `updateSettings` | FN | `[settings, saveSettingsMutation]` | CoreData |
| 11 | `addCollaborator` | FN | `[projects, updateProject]` | CoreData |
| 12 | `removeCollaborator` | FN | `[projects, updateProject]` | CoreData |
| 13 | `changeOrders` | DATA | `changeOrders` state | FinancialsData |
| 14 | `addChangeOrder` | FN | `[changeOrders, saveChangeOrdersMutation, canSync, userId]` | FinancialsData |
| 15 | `updateChangeOrder` | FN | `[changeOrders, projects, saveChangeOrdersMutation, saveProjectsMutation, syncProjectToSupabase, canSync]` | CrossDomain |
| 16 | `getChangeOrdersForProject` | FN | `[changeOrders]` | FinancialsData |
| 17 | `addInvoice` | FN | `[invoices, saveInvoicesMutation, canSync, userId]` | FinancialsData |
| 18 | `updateInvoice` | FN | `[invoices, saveInvoicesMutation, canSync]` | FinancialsData |
| 19 | `getInvoicesForProject` | FN | `[invoices]` | FinancialsData |
| 20 | `getTotalOutstandingBalance` | FN | `[invoices]` | FinancialsData |
| 21 | `invoices` | DATA | `invoices` state | FinancialsData |
| 22 | `commitments` | DATA | `commitments` state | FinancialsData |
| 23 | `addCommitment` | FN | `[commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow]` — `commitmentToRow` deps: `[userId]` | FinancialsData |
| 24 | `updateCommitment` | FN | `[commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow]` | FinancialsData |
| 25 | `deleteCommitment` | FN | `[commitments, saveCommitmentsMutation, canSync]` | FinancialsData |
| 26 | `getCommitmentsForProject` | FN | `[commitments]` | FinancialsData |
| 27 | `prequalPackets` | DATA | `prequalPackets` state | FinancialsData |
| 28 | `upsertPrequalPacket` | FN | `[prequalPackets, savePrequalMutation, canSync, userId, prequalToRow]` — `prequalToRow` deps: `[userId]` | FinancialsData |
| 29 | `deletePrequalPacket` | FN | `[prequalPackets, savePrequalMutation, canSync]` | FinancialsData |
| 30 | `getPrequalPacketForSub` | FN | `[prequalPackets]` | FinancialsData |
| 31 | `getPrequalPacketByToken` | FN | `[prequalPackets]` | FinancialsData |
| 32 | `dailyReports` | DATA | `dailyReports` state | FieldData |
| 33 | `addDailyReport` | FN | `[dailyReports, saveDailyReportsMutation, canSync, userId, propagateProgressFromDFR]` — `propagateProgressFromDFR` deps: `[projects, updateProject]` (updateProject depends on projects) | CrossDomain |
| 34 | `updateDailyReport` | FN | `[dailyReports, saveDailyReportsMutation, canSync, propagateProgressFromDFR]` — `propagateProgressFromDFR` deps: `[projects, updateProject]` | CrossDomain |
| 35 | `getDailyReportsForProject` | FN | `[dailyReports]` | FieldData |
| 36 | `subcontractors` | DATA | `subcontractors` state | PreconData |
| 37 | `addSubcontractor` | FN | `[subcontractors, saveSubsMutation, canSync, userId]` | PreconData |
| 38 | `updateSubcontractor` | FN | `[subcontractors, saveSubsMutation, canSync]` | PreconData |
| 39 | `deleteSubcontractor` | FN | `[subcontractors, saveSubsMutation, canSync]` | PreconData |
| 40 | `getSubcontractor` | FN | `[subcontractors]` | PreconData |
| 41 | `punchItems` | DATA | `punchItems` state | FieldData |
| 42 | `addPunchItem` | FN | `[punchItems, savePunchItemsMutation, canSync, userId]` | FieldData |
| 43 | `updatePunchItem` | FN | `[punchItems, savePunchItemsMutation, canSync]` | FieldData |
| 44 | `deletePunchItem` | FN | `[punchItems, savePunchItemsMutation, canSync]` | FieldData |
| 45 | `getPunchItemsForProject` | FN | `[punchItems]` | FieldData |
| 46 | `projectPhotos` | DATA | `projectPhotos` state | FieldData |
| 47 | `addProjectPhoto` | FN | `[projectPhotos, savePhotosMutation, canSync, userId]` | FieldData |
| 48 | `updateProjectPhoto` | FN | `[projectPhotos, savePhotosMutation, canSync]` | FieldData |
| 49 | `deleteProjectPhoto` | FN | `[projectPhotos, savePhotosMutation, canSync]` | FieldData |
| 50 | `getPhotosForProject` | FN | `[projectPhotos]` | FieldData |
| 51 | `priceAlerts` | DATA | `priceAlerts` state | CoreData |
| 52 | `addPriceAlert` | FN | `[priceAlerts, savePriceAlertsMutation, canSync, userId]` | CoreData |
| 53 | `updatePriceAlert` | FN | `[priceAlerts, savePriceAlertsMutation, canSync]` | CoreData |
| 54 | `deletePriceAlert` | FN | `[priceAlerts, savePriceAlertsMutation, canSync]` | CoreData |
| 55 | `contacts` | DATA | `contacts` state | CoreData |
| 56 | `addContact` | FN | `[contacts, saveContactsMutation, canSync, userId]` | CoreData |
| 57 | `updateContact` | FN | `[contacts, saveContactsMutation, canSync]` | CoreData |
| 58 | `deleteContact` | FN | `[contacts, saveContactsMutation, canSync]` | CoreData |
| 59 | `getContact` | FN | `[contacts]` | CoreData |
| 60 | `commEvents` | DATA | `commEvents` state | CoreData |
| 61 | `addCommEvent` | FN | `[commEvents, saveCommEventsMutation, canSync, userId]` | CoreData |
| 62 | `getCommEventsForProject` | FN | `[commEvents]` | CoreData |
| 63 | `leads` | DATA | `leads` state | PreconData |
| 64 | `addLead` | FN | `[leads, saveLeadsMutation, canSync, userId]` | PreconData |
| 65 | `updateLead` | FN | `[leads, saveLeadsMutation, canSync]` | PreconData |
| 66 | `deleteLead` | FN | `[leads, saveLeadsMutation, canSync]` | PreconData |
| 67 | `getLead` | FN | `[leads]` | PreconData |
| 68 | `getLeadsByStage` | FN | `[leads]` | PreconData |
| 69 | `addLeadTouch` | FN | `[leads, updateLead]` — `updateLead` depends on `[leads, saveLeadsMutation, canSync]` | PreconData |
| 70 | `convertLeadToProject` | FN | `[leads, projects, saveProjectsMutation, canSync, userId, updateLead]` | CrossDomain |
| 71 | `bidPackages` | DATA | `bidPackages` state | PreconData |
| 72 | `bidPackageBids` | DATA | `bidPackageBids` state | PreconData |
| 73 | `addBidPackage` | FN | `[bidPackages, saveBidPackagesMutation, canSync, userId]` | PreconData |
| 74 | `updateBidPackage` | FN | `[bidPackages, saveBidPackagesMutation, canSync]` | PreconData |
| 75 | `deleteBidPackage` | FN | `[bidPackages, bidPackageBids, saveBidPackagesMutation, saveBidPackageBidsMutation, canSync]` | PreconData |
| 76 | `getBidPackagesForProject` | FN | `[bidPackages]` | PreconData |
| 77 | `getBidPackage` | FN | `[bidPackages]` | PreconData |
| 78 | `addBidPackageBid` | FN | `[bidPackages, bidPackageBids, saveBidPackageBidsMutation, updateBidPackage, canSync, userId]` — `updateBidPackage` depends on `[bidPackages, ...]` | PreconData |
| 79 | `updateBidPackageBid` | FN | `[bidPackageBids, saveBidPackageBidsMutation, canSync]` | PreconData |
| 80 | `deleteBidPackageBid` | FN | `[bidPackageBids, saveBidPackageBidsMutation, canSync]` | PreconData |
| 81 | `getBidsForPackage` | FN | `[bidPackageBids]` | PreconData |
| 82 | `awardBidPackage` | FN | `[bidPackages, bidPackageBids, commitments, projects, saveCommitmentsMutation, saveBidPackagesMutation, saveBidPackageBidsMutation, saveProjectsMutation, syncProjectToSupabase, canSync]` | CrossDomain |
| 83 | `rfis` | DATA | `rfis` state | DocsData |
| 84 | `addRFI` | FN | `[rfis, saveRfisMutation, canSync, userId]` | DocsData |
| 85 | `updateRFI` | FN | `[rfis, saveRfisMutation, canSync]` | DocsData |
| 86 | `deleteRFI` | FN | `[rfis, saveRfisMutation, canSync]` | DocsData |
| 87 | `getRFIsForProject` | FN | `[rfis]` | DocsData |
| 88 | `permits` | DATA | `permits` state | DocsData |
| 89 | `addPermit` | FN | `[permits, savePermitsMutation, canSync, userId, permitToRow]` — `permitToRow` deps: `[userId]` | DocsData |
| 90 | `updatePermit` | FN | `[permits, savePermitsMutation, canSync, userId, permitToRow]` | DocsData |
| 91 | `deletePermit` | FN | `[permits, savePermitsMutation, canSync]` | DocsData |
| 92 | `getPermitsForProject` | FN | `[permits]` | DocsData |
| 93 | `aiaPayApps` | DATA | `aiaPayApps` state | FinancialsData |
| 94 | `addAIAPayApp` | FN | `[aiaPayApps, saveAiaPayAppsMutation, canSync, userId, aiaPayAppToRow]` — `aiaPayAppToRow` deps: `[userId]` | FinancialsData |
| 95 | `deleteAIAPayApp` | FN | `[aiaPayApps, saveAiaPayAppsMutation, canSync]` | FinancialsData |
| 96 | `getAIAPayAppsForProject` | FN | `[aiaPayApps]` | FinancialsData |
| 97 | `subPortalLinks` | DATA | `subPortalLinks` state | DocsData |
| 98 | `upsertSubPortalLink` | FN | `[subPortalLinks, saveSubPortalLinksMutation, canSync, userId]` | DocsData |
| 99 | `deleteSubPortalLink` | FN | `[subPortalLinks, saveSubPortalLinksMutation, canSync]` | DocsData |
| 100 | `getSubPortalLinkFor` | FN | `[subPortalLinks]` | DocsData |
| 101 | `getSubPortalLinksForProject` | FN | `[subPortalLinks]` | DocsData |
| 102 | `submittals` | DATA | `submittals` state | DocsData |
| 103 | `addSubmittal` | FN | `[submittals, saveSubmittalsMutation, canSync, userId]` | DocsData |
| 104 | `updateSubmittal` | FN | `[submittals, saveSubmittalsMutation, canSync]` | DocsData |
| 105 | `deleteSubmittal` | FN | `[submittals, saveSubmittalsMutation, canSync]` | DocsData |
| 106 | `getSubmittalsForProject` | FN | `[submittals]` | DocsData |
| 107 | `addReviewCycle` | FN | `[submittals, updateSubmittal]` — `updateSubmittal` depends on `[submittals, ...]` | DocsData |
| 108 | `oacMeetings` | DATA | `oacMeetings` state | DocsData |
| 109 | `addOACMeeting` | FN | `[oacMeetings, saveOACMeetingsMutation, canSync, oacMeetingToRow]` — `oacMeetingToRow` deps: `[userId]` | DocsData |
| 110 | `updateOACMeeting` | FN | `[oacMeetings, saveOACMeetingsMutation, canSync, oacMeetingToRow]` | DocsData |
| 111 | `deleteOACMeeting` | FN | `[oacMeetings, saveOACMeetingsMutation, canSync]` | DocsData |
| 112 | `getOACMeetingsForProject` | FN | `[oacMeetings]` | DocsData |
| 113 | `cois` | DATA | `cois` state | PreconData |
| 114 | `addCOI` | FN | `[cois, saveCOIsMutation, canSync, coiToRow]` — `coiToRow` deps: `[userId]` | PreconData |
| 115 | `updateCOI` | FN | `[cois, saveCOIsMutation, canSync, coiToRow]` | PreconData |
| 116 | `deleteCOI` | FN | `[cois, saveCOIsMutation, canSync]` | PreconData |
| 117 | `getCOIsForSub` | FN | `[cois]` | PreconData |
| 118 | `equipment` | DATA | `equipment` state | FieldData |
| 119 | `addEquipment` | FN | `[equipment, saveEquipmentMutation, canSync, userId]` | FieldData |
| 120 | `updateEquipment` | FN | `[equipment, saveEquipmentMutation, canSync]` | FieldData |
| 121 | `deleteEquipment` | FN | `[equipment, saveEquipmentMutation, canSync]` | FieldData |
| 122 | `logUtilization` | FN | `[equipment, saveEquipmentMutation, canSync]` | FieldData |
| 123 | `getEquipmentForProject` | FN | `[equipment]` | FieldData |
| 124 | `getEquipmentCostForProject` | FN | `[equipment]` | FieldData |
| 125 | `warranties` | DATA | `warranties` state | DocsData |
| 126 | `addWarranty` | FN | `[warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow]` — `persistWarranties` deps: `[]` (no data); `computeWarrantyStatus` deps: `[]`; `warrantyToRow` deps: `[userId]` | DocsData |
| 127 | `updateWarranty` | FN | `[warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow]` | DocsData |
| 128 | `deleteWarranty` | FN | `[warranties, persistWarranties, canSync]` | DocsData |
| 129 | `getWarrantiesForProject` | FN | `[warranties]` | DocsData |
| 130 | `addWarrantyClaim` | FN | `[warranties, persistWarranties, canSync, userId, warrantyToRow]` | DocsData |
| 131 | `portalMessages` | DATA | `portalMessages` state | DocsData |
| 132 | `addPortalMessage` | FN | `[portalMessages, persistPortalMessages]` — `persistPortalMessages` deps: `[]` | DocsData |
| 133 | `markPortalMessagesRead` | FN | `[portalMessages, persistPortalMessages]` | DocsData |
| 134 | `getPortalMessagesForProject` | FN | `[portalMessages]` | DocsData |
| 135 | `getUnreadPortalMessageCount` | FN | `[portalMessages]` | DocsData |
| 136 | `getTotalUnreadPortalCountForGc` | FN | `[portalMessages]` | DocsData |
| 137 | `planSheets` | DATA | `planSheets` state | FieldData |
| 138 | `addPlanSheet` | FN | `[planSheets, persistPlanSheets, canSync, userId]` — `persistPlanSheets` deps: `[]` | FieldData |
| 139 | `updatePlanSheet` | FN | `[planSheets, persistPlanSheets, canSync]` | FieldData |
| 140 | `deletePlanSheet` | FN | `[planSheets, drawingPins, planMarkups, planCalibrations, persistPlanSheets, persistDrawingPins, persistPlanMarkups, persistPlanCalibrations, canSync]` | FieldData |
| 141 | `getPlanSheetsForProject` | FN | `[planSheets]` | FieldData |
| 142 | `getPlanSheet` | FN | `[planSheets]` | FieldData |
| 143 | `drawingPins` | DATA | `drawingPins` state | FieldData |
| 144 | `addDrawingPin` | FN | `[drawingPins, persistDrawingPins, canSync, userId]` | FieldData |
| 145 | `updateDrawingPin` | FN | `[drawingPins, persistDrawingPins, canSync]` | FieldData |
| 146 | `deleteDrawingPin` | FN | `[drawingPins, persistDrawingPins, canSync]` | FieldData |
| 147 | `getPinsForPlan` | FN | `[drawingPins]` | FieldData |
| 148 | `getPinsForPhoto` | FN | `[drawingPins]` | FieldData |
| 149 | `planMarkups` | DATA | `planMarkups` state | FieldData |
| 150 | `addPlanMarkup` | FN | `[planMarkups, persistPlanMarkups, canSync, userId]` | FieldData |
| 151 | `deletePlanMarkup` | FN | `[planMarkups, persistPlanMarkups, canSync]` | FieldData |
| 152 | `getMarkupsForPlan` | FN | `[planMarkups]` | FieldData |
| 153 | `planCalibrations` | DATA | `planCalibrations` state | FieldData |
| 154 | `upsertPlanCalibration` | FN | `[planCalibrations, persistPlanCalibrations, canSync, userId]` | FieldData |
| 155 | `getCalibrationForPlan` | FN | `[planCalibrations]` | FieldData |

---

## Per-Bucket Counts

| Bucket | Count | Keys |
|--------|-------|------|
| CoreData | 23 | projects, settings, hasSeenOnboarding, isLoading, addProject, updateProject, deleteProject, getProject, updateSettings, addCollaborator, removeCollaborator, priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, contacts, addContact, updateContact, deleteContact, getContact, commEvents, addCommEvent, getCommEventsForProject |
| FinancialsData | 22 | changeOrders, addChangeOrder, getChangeOrdersForProject, addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices, commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject, prequalPackets, upsertPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken, aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject |
| FieldData | 38 | dailyReports, getDailyReportsForProject, punchItems, addPunchItem, updatePunchItem, deletePunchItem, getPunchItemsForProject, projectPhotos, addProjectPhoto, updateProjectPhoto, deleteProjectPhoto, getPhotosForProject, equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject, planSheets, addPlanSheet, updatePlanSheet, deletePlanSheet, getPlanSheetsForProject, getPlanSheet, drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto, planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan, planCalibrations, upsertPlanCalibration, getCalibrationForPlan |
| PreconData | 28 | subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor, leads, addLead, updateLead, deleteLead, getLead, getLeadsByStage, addLeadTouch, bidPackages, bidPackageBids, addBidPackage, updateBidPackage, deleteBidPackage, getBidPackagesForProject, getBidPackage, addBidPackageBid, updateBidPackageBid, deleteBidPackageBid, getBidsForPackage, cois, addCOI, updateCOI, deleteCOI, getCOIsForSub |
| DocsData | 38 | rfis, addRFI, updateRFI, deleteRFI, getRFIsForProject, permits, addPermit, updatePermit, deletePermit, getPermitsForProject, subPortalLinks, upsertSubPortalLink, deleteSubPortalLink, getSubPortalLinkFor, getSubPortalLinksForProject, submittals, addSubmittal, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle, oacMeetings, addOACMeeting, updateOACMeeting, deleteOACMeeting, getOACMeetingsForProject, warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim, portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc |
| StableActions | 1 | completeOnboarding |
| CrossDomain | 5 | updateChangeOrder, addDailyReport, updateDailyReport, convertLeadToProject, awardBidPackage |

**Sum check:** 23 + 22 + 38 + 28 + 38 + 1 + 5 = **155**

---

## Reconciliation

```
TOTAL keys in useProjects() = 155; sum of buckets = 155; dropped = 0; duplicated = 0
```

---

## CrossDomain Analysis

Each entry is CrossDomain because its recorded dep array (including one level of transitive deps via helper callbacks) touches data arrays from ≥ 2 of the 5 data domains.

### 1. `updateChangeOrder`
**Dep array:** `[changeOrders, projects, saveChangeOrdersMutation, saveProjectsMutation, syncProjectToSupabase, canSync]`

- `changeOrders` → **FinancialsData**
- `projects` → **CoreData**

When a CO is approved and has `scheduleImpactDays > 0`, `updateChangeOrder` reads `projects`, computes a new schedule, calls `setProjects`, `saveProjectsMutation.mutate(nextProjects)`, and `syncProjectToSupabase(proj, 'upsert')`. Both domains are touched directly in the same callback body.

**Verdict: CrossDomain (FinancialsData + CoreData)**

---

### 2. `addDailyReport`
**Dep array:** `[dailyReports, saveDailyReportsMutation, canSync, userId, propagateProgressFromDFR]`

`propagateProgressFromDFR` dep array: `[projects, updateProject]`
- `dailyReports` → **FieldData**
- `projects` (via `propagateProgressFromDFR`) → **CoreData**

`addDailyReport` calls `propagateProgressFromDFR(report)` inline. That helper reads `projects` to find the linked project's schedule tasks and calls `updateProject` (which mutates the `projects` array).

**Verdict: CrossDomain (FieldData + CoreData)**

---

### 3. `updateDailyReport`
**Dep array:** `[dailyReports, saveDailyReportsMutation, canSync, propagateProgressFromDFR]`

`propagateProgressFromDFR` dep array: `[projects, updateProject]`
- `dailyReports` → **FieldData**
- `projects` (via `propagateProgressFromDFR`) → **CoreData**

Same cross-domain cascade as `addDailyReport`.

**Verdict: CrossDomain (FieldData + CoreData)**

---

### 4. `convertLeadToProject`
**Dep array:** `[leads, projects, saveProjectsMutation, canSync, userId, updateLead]`

- `leads` → **PreconData**
- `projects` → **CoreData**

`convertLeadToProject` reads `leads` to find the lead, reads `projects` to avoid duplicates (via `saveProjectsMutation.mutate([newProject, ...projects])`), creates a new `Project`, calls `setProjects`, `saveProjectsMutation.mutate(...)`, then calls `updateLead(leadId, { stage: 'won', ... })` which mutates the `leads` array.

**Verdict: CrossDomain (PreconData + CoreData)**

---

### 5. `awardBidPackage`
**Dep array:** `[bidPackages, bidPackageBids, commitments, projects, saveCommitmentsMutation, saveBidPackagesMutation, saveBidPackageBidsMutation, saveProjectsMutation, syncProjectToSupabase, canSync]`

- `bidPackages` → **PreconData**
- `bidPackageBids` → **PreconData**
- `commitments` → **FinancialsData**
- `projects` → **CoreData**

`awardBidPackage` atomically: creates a `Commitment` (FinancialsData), updates `bidPackages` and `bidPackageBids` (PreconData), and conditionally locks allowance items on the linked `Project`'s `linkedEstimate` (CoreData). All four arrays are read and/or mutated in the same callback.

**Verdict: CrossDomain (PreconData + FinancialsData + CoreData)** — touches 3 domains.

---

## Notes for Task 2 (Implementation)

1. **`updateChangeOrder` in CrossDomain** — the CO→project schedule cascade is a genuine cross-domain write. Task 2 must keep this callback in a CrossDomain context (or pass `updateProject` / `setProjects` as a prop/ref from CoreData into FinancialsData context). Do not split it into FinancialsData-only.

2. **`addDailyReport` / `updateDailyReport` in CrossDomain** — both call `propagateProgressFromDFR` which writes to `projects`. If `propagateProgressFromDFR` were extracted to CoreData and exposed as a stable callback (accepting a `DailyFieldReport` arg), these two could become FieldData. But that requires a non-trivial refactor. Task 2 decision: treat as CrossDomain for now.

3. **`awardBidPackage` touches 3 domains** — this is the most entangled function. It cannot be assigned to PreconData, FinancialsData, or CoreData alone. It is a genuine CrossDomain orchestrator. Task 2 should keep it in CrossDomain context, providing access to the needed setters/mutations from each domain context.

4. **`deletePlanSheet`** — touches `planSheets`, `drawingPins`, `planMarkups`, `planCalibrations` in its dep array; all four are **FieldData** arrays, so it remains FieldData (all within a single domain). Not CrossDomain.

5. **`completeOnboarding`** — no domain data arrays in deps (`[queryClient, userId, canSync]`); pure side-effect function → **StableActions**.

6. **`prequalPackets`** grouped under **FinancialsData** (not PreconData) because prequalification packets are financial vetting documents tied to the commitment/payment workflow (w9, insurance, financials). They map to `FinancialsData` despite being conceptually "pre-construction", which is why their CRUD functions have deps confined to `prequalPackets` + mutations alone (no overlap with other domains).

7. **`subPortalLinks`** grouped under **DocsData** because sub portal links are document/access-sharing artifacts (share URLs, passcodes), not transactional financial or field-work data.
