// hooks/useDemoJobPorts.ts — plugs the Demo Job writer (utils/demoJob/writer)
// into the app's own contexts, engines and stores.
//
// This is the whole list of things the builder can do. Every write is one of
// the functions a screen already calls: the contexts' add and delete
// functions, the lien waiver / contract / selections engines' save functions,
// the tutorial's bundled-image upload, and the Living Model's store. There is
// no edge function, no email, no notification and no AI call in this file.
//
// `ready` is false until the app has read its project list: before that, "no
// demo job" is not known, and Create would make a second one.
//
// The lists and functions are read through refs that are refreshed on every
// render, so the writer always sees the app's LATEST list after an add (many
// add functions build on the list as of the last render).
import { useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { useCrew } from '@/contexts/CrewContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTimeEntries } from '@/hooks/useTimeEntries';
import { isOfflineNow } from '@/hooks/useOnline';
import { fetchContractsForProject, saveContract } from '@/utils/contractEngine';
import { fetchLienWaiversForProject, saveLienWaiver } from '@/utils/lienWaiverEngine';
import { loadJobModel, saveJobModel } from '@/utils/livingModel/store';
import { livingModelBackupKey, livingModelKeptKey, livingModelKey, livingModelSwapKey, livingModelSyncKey } from '@/utils/livingModel/storeCore';
import { getOwnOfflineQueue, supabaseWrite } from '@/utils/offlineQueue';
import { fetchSelectionsForProject, saveSelectionCategory, saveSelectionOption } from '@/utils/selectionsEngine';
import { ensureTutorialPlan, samplePhotoImage } from '@/utils/tutorial/sandbox';
import type { DemoActions, DemoPorts, DemoWorld } from '@/utils/demoJob/writer';

export function useDemoJobPorts(): DemoPorts {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const api = useProjects();
  const safety = useSafety();
  const crew = useCrew();
  const time = useTimeEntries();

  const world: DemoWorld = {
    projects: api.projects,
    subcontractors: api.subcontractors,
    contacts: api.contacts,
    cois: api.cois,
    commitments: api.commitments,
    changeOrders: api.changeOrders,
    invoices: api.invoices,
    aiaPayApps: api.aiaPayApps,
    dailyReports: api.dailyReports,
    rfis: api.rfis,
    submittals: api.submittals,
    punchItems: api.punchItems,
    permits: api.permits,
    oacMeetings: api.oacMeetings,
    warranties: api.warranties,
    toolboxTalks: safety.toolboxTalks,
    hazards: safety.hazards,
    safetyIncidents: safety.incidents,
    deliveries: api.deliveries,
    buildingAccessRules: api.buildingAccessRules,
    accessReservations: api.accessReservations,
    delayEvents: api.delayEvents,
    equipment: api.equipment,
    fieldTickets: api.fieldTickets,
    crew: crew.crewMembers,
    timeEntries: time.entries,
    projectPhotos: api.projectPhotos,
    planSheets: api.planSheets,
  };
  const actions: DemoActions = {
    addProject: api.addProject,
    addSubcontractor: api.addSubcontractor,
    addContact: api.addContact,
    addCOI: api.addCOI,
    addCommitment: api.addCommitment,
    addChangeOrders: api.addChangeOrders,
    addInvoice: api.addInvoice,
    addAIAPayApp: api.addAIAPayApp,
    addDailyReport: api.addDailyReport,
    addRFIs: api.addRFIs,
    // The four records whose id the app would otherwise make are handed the builder's own id.
    addSubmittals: (subs) => api.addSubmittals(subs, { ids: subs.map((s) => s.id) }),
    addPunchItems: api.addPunchItems,
    addPermit: ({ id, ...permit }) => api.addPermit(permit, { id }),
    addOACMeeting: api.addOACMeeting,
    addWarranty: api.addWarranty,
    addToolboxTalk: safety.addToolboxTalk,
    addHazard: safety.addHazard,
    addDelivery: api.addDelivery,
    setBuildingAccess: api.setBuildingAccess,
    addReservation: api.addReservation,
    addDelayEvent: api.addDelayEvent,
    addEquipment: ({ id, ...equip }) => api.addEquipment(equip, { id }),
    addFieldTicket: api.addFieldTicket,
    addCrewMember: crew.addCrewMember,
    addManualEntry: time.addManualEntry,
    addProjectPhoto: api.addProjectPhoto,
    // The id and nothing else: with no count handed in, the app's delete asks the server about safety records.
    deleteProject: (id) => api.deleteProject(id),
    deleteSubcontractor: api.deleteSubcontractor,
    deleteContact: api.deleteContact,
    deleteEquipment: api.deleteEquipment,
    deleteCrewMember: crew.deleteCrewMember,
    deleteTimeEntry: time.deleteEntry,
  };

  const worldRef = useRef(world);
  worldRef.current = world;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const apiRef = useRef(api);
  apiRef.current = api;
  const userRef = useRef(userId);
  userRef.current = userId;

  return useMemo<DemoPorts>(() => ({
    world: () => worldRef.current,
    actions: () => actionsRef.current,
    ready: () => apiRef.current.projectsLoaded,
    online: () => !isOfflineNow() && !!userRef.current,
    pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    queuedWrites: async () => (await getOwnOfflineQueue().catch(() => [])).length,
    engines: {
      lienWaiverIds: async (projectId) => (await fetchLienWaiversForProject(projectId)).map((w) => w.id),
      saveLienWaiver: (w) => saveLienWaiver(w),
      contractIds: async (projectId) => (await fetchContractsForProject(projectId)).map((c) => c.id),
      saveContract: (c) => saveContract(c),
      selectionIds: async (projectId) => (await fetchSelectionsForProject(projectId)).map((c) => c.id),
      saveSelection: async (s) => {
        if (!(await saveSelectionCategory(s.category))) return false;
        for (const o of s.options) if (!(await saveSelectionOption(o))) return false;
        return true;
      },
    },
    assets: {
      ensurePlan: async (projectId) => {
        const res = await ensureTutorialPlan(projectId, {
          getWorld: () => ({ projects: apiRef.current.projects, planSheets: apiRef.current.planSheets, userId: userRef.current }),
          getActions: () => apiRef.current,
        });
        return res.ok ? null : res.reason;
      },
      samplePhotoUri: async () => (await samplePhotoImage())?.uri ?? null,
    },
    model: {
      has: async (projectId) => (await loadJobModel(userRef.current, projectId)).model.rooms.length > 0,
      save: (model) => saveJobModel(userRef.current, model, new Date().toISOString(), 'ready'),
      remove: async (projectId) => {
        // The model, its unreadable-copy backup, and the sync lane's three notes about it (all on this device).
        const u = userRef.current;
        const keys = [livingModelKey(u, projectId), livingModelBackupKey(u, projectId), livingModelSyncKey(u, projectId), livingModelKeptKey(u, projectId), livingModelSwapKey(u, projectId)].filter((k): k is string => !!k);
        if (keys.length) await AsyncStorage.multiRemove(keys).catch(() => undefined);
      },
    },
    queueDelete: (table, id) => supabaseWrite(table, 'delete', { id }),
  }), []);
}
