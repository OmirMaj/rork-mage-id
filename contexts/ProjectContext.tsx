import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { Project, AppSettings, CompanyBranding, ProjectCollaborator, ChangeOrder, Invoice, DailyFieldReport, Subcontractor, PunchItem, ProjectPhoto, PriceAlert, Contact, CommunicationEvent, RFI, Submittal, SubmittalReviewCycle, Equipment, EquipmentUtilizationEntry, PDFNamingSettings, Warranty, WarrantyClaim, PortalMessage, Commitment, PrequalPacket, PlanSheet, DrawingPin, PlanCalibration, PlanMarkup, Permit, SavedAIAPayApp } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';

const PROJECTS_KEY = 'buildwise_projects';
const SETTINGS_KEY = 'buildwise_settings';
const ONBOARDING_KEY = 'buildwise_onboarding_complete';
const CHANGE_ORDERS_KEY = 'tertiary_change_orders';
const INVOICES_KEY = 'tertiary_invoices';
const DAILY_REPORTS_KEY = 'tertiary_daily_reports';
const SUBS_KEY = 'tertiary_subcontractors';
const PUNCH_ITEMS_KEY = 'tertiary_punch_items';
const PHOTOS_KEY = 'tertiary_photos';
const PRICE_ALERTS_KEY = 'tertiary_price_alerts';
const CONTACTS_KEY = 'tertiary_contacts';
const COMM_EVENTS_KEY = 'tertiary_comm_events';
const RFIS_KEY = 'tertiary_rfis';
const SUBMITTALS_KEY = 'tertiary_submittals';
const EQUIPMENT_KEY = 'tertiary_equipment';
const WARRANTIES_KEY = 'tertiary_warranties';
const PORTAL_MESSAGES_KEY = 'tertiary_portal_messages';
const COMMITMENTS_KEY = 'tertiary_commitments';
const PREQUAL_KEY = 'tertiary_prequal_packets';
const DRAWING_PINS_KEY = 'tertiary_drawing_pins';
const PLAN_CALIBRATIONS_KEY = 'tertiary_plan_calibrations';
const PLAN_SHEETS_KEY = 'tertiary_plan_sheets';
const PLAN_MARKUPS_KEY = 'tertiary_plan_markups';
const PERMITS_KEY = 'tertiary_permits';
const AIA_PAY_APPS_KEY = 'tertiary_aia_pay_apps';

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
  taxRate: 7.5,
  contingencyRate: 10,
  branding: DEFAULT_BRANDING,
};

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.log('[ProjectContext] Local save failed for', key, err);
  }
}

export const [ProjectProvider, useProjects] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [prequalPackets, setPrequalPackets] = useState<PrequalPacket[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyFieldReport[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  const [projectPhotos, setProjectPhotos] = useState<ProjectPhoto[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  const [rfis, setRfis] = useState<RFI[]>([]);
  const [submittals, setSubmittals] = useState<Submittal[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [aiaPayApps, setAiaPayApps] = useState<SavedAIAPayApp[]>([]);
  const syncDebounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const canSync = !!userId && isSupabaseConfigured;

  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    queryFn: async () => {
      console.log('[ProjectContext] Loading projects');
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string, type: r.type as string,
              location: (r.location as string) ?? '', squareFootage: Number(r.square_footage) || 0,
              quality: (r.quality as string) ?? 'standard', description: (r.description as string) ?? '',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              estimate: r.estimate as Project['estimate'], schedule: r.schedule as Project['schedule'],
              linkedEstimate: r.linked_estimate as Project['linkedEstimate'],
              status: (r.status as Project['status']) ?? 'draft',
              collaborators: r.collaborators as ProjectCollaborator[] ?? [],
              clientPortal: r.client_portal as Project['clientPortal'],
              targetBudget: r.target_budget as Project['targetBudget'],
              closedAt: r.closed_at as string | undefined, photoCount: Number(r.photo_count) || 0,
            })) as Project[];
            await saveLocal(PROJECTS_KEY, mapped);
            return mapped;
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase fetch failed, falling back to local:', err);
        }
      }
      return loadLocal<Project[]>(PROJECTS_KEY, []);
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['settings', userId],
    queryFn: async () => {
      console.log('[ProjectContext] Loading settings');
      if (canSync) {
        try {
          const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
          if (!error && data) {
            const s: AppSettings = {
              location: (data.location as string) ?? 'United States',
              units: ((data.units as string) ?? 'imperial') as 'imperial' | 'metric',
              taxRate: Number(data.tax_rate) || 7.5,
              contingencyRate: Number(data.contingency_rate) || 10,
              branding: {
                companyName: (data.company_name as string) ?? '', contactName: (data.contact_name as string) ?? '',
                email: (data.email as string) ?? '', phone: (data.phone as string) ?? '',
                address: (data.address as string) ?? '', licenseNumber: (data.license_number as string) ?? '',
                tagline: (data.tagline as string) ?? '', logoUri: data.logo_uri as string | undefined,
                signatureData: data.signature_data as string[] | undefined,
              },
              themeColors: data.theme_colors as AppSettings['themeColors'],
              biometricsEnabled: data.biometrics_enabled as boolean,
              dfrRecipients: data.dfr_recipients as string[],
            };
            await saveLocal(SETTINGS_KEY, s);
            return s;
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase settings fetch failed:', err);
        }
      }
      return loadLocal<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    },
  });

  const changeOrdersQuery = useQuery({
    queryKey: ['changeOrders', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('change_orders').select('*').order('created_at', { ascending: false });
          if (!error && data) {
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
            })) as ChangeOrder[];
            await saveLocal(CHANGE_ORDERS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<ChangeOrder[]>(CHANGE_ORDERS_KEY, []);
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoices', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              type: r.type as Invoice['type'], progressPercent: r.progress_percent as number | undefined,
              issueDate: r.issue_date as string, dueDate: r.due_date as string,
              paymentTerms: r.payment_terms as Invoice['paymentTerms'], notes: (r.notes as string) ?? '',
              lineItems: r.line_items as Invoice['lineItems'], subtotal: Number(r.subtotal),
              taxRate: Number(r.tax_rate), taxAmount: Number(r.tax_amount), totalDue: Number(r.total_due),
              amountPaid: Number(r.amount_paid), status: r.status as Invoice['status'],
              payments: r.payments as Invoice['payments'], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Invoice[];
            await saveLocal(INVOICES_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Invoice[]>(INVOICES_KEY, []);
    },
  });

  // Commitments — signed subs/POs for job costing. Local-only for now; a
  // Supabase `commitments` table lives in a future migration.
  const commitmentsQuery = useQuery({
    queryKey: ['commitments', userId],
    queryFn: async () => loadLocal<Commitment[]>(COMMITMENTS_KEY, []),
  });

  // Prequal packets — one per subcontractor. Magic-link token lives on
  // the packet; the sub's /prequal-form route looks the packet up by
  // token. No auth on the sub side by design.
  const prequalQuery = useQuery({
    queryKey: ['prequalPackets', userId],
    queryFn: async () => loadLocal<PrequalPacket[]>(PREQUAL_KEY, []),
  });

  const dailyReportsQuery = useQuery({
    queryKey: ['dailyReports', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('daily_reports').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, date: r.date as string,
              weather: r.weather as DailyFieldReport['weather'], manpower: r.manpower as DailyFieldReport['manpower'],
              workPerformed: (r.work_performed as string) ?? '', materialsDelivered: (r.materials_delivered as string[]) ?? [],
              issuesAndDelays: (r.issues_and_delays as string) ?? '', photos: (r.photos as DailyFieldReport['photos']) ?? [],
              status: (r.status as DailyFieldReport['status']) ?? 'draft',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as DailyFieldReport[];
            await saveLocal(DAILY_REPORTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, []);
    },
  });

  const subsQuery = useQuery({
    queryKey: ['subcontractors', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('subcontractors').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyName: (r.company_name as string) ?? '', contactName: (r.contact_name as string) ?? '',
              phone: (r.phone as string) ?? '', email: (r.email as string) ?? '', address: (r.address as string) ?? '',
              trade: (r.trade as Subcontractor['trade']) ?? 'General', licenseNumber: (r.license_number as string) ?? '',
              licenseExpiry: (r.license_expiry as string) ?? '', coiExpiry: (r.coi_expiry as string) ?? '',
              w9OnFile: (r.w9_on_file as boolean) ?? false, bidHistory: (r.bid_history as Subcontractor['bidHistory']) ?? [],
              assignedProjects: (r.assigned_projects as string[]) ?? [], notes: (r.notes as string) ?? '',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Subcontractor[];
            await saveLocal(SUBS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Subcontractor[]>(SUBS_KEY, []);
    },
  });

  const punchItemsQuery = useQuery({
    queryKey: ['punchItems', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('punch_items').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, description: r.description as string,
              location: (r.location as string) ?? '', assignedSub: (r.assigned_sub as string) ?? '',
              assignedSubId: r.assigned_sub_id as string | undefined, dueDate: r.due_date as string,
              priority: (r.priority as PunchItem['priority']) ?? 'medium', status: (r.status as PunchItem['status']) ?? 'open',
              photoUri: r.photo_uri as string | undefined, rejectionNote: r.rejection_note as string | undefined,
              closedAt: r.closed_at as string | undefined, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as PunchItem[];
            await saveLocal(PUNCH_ITEMS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PunchItem[]>(PUNCH_ITEMS_KEY, []);
    },
  });

  const photosQuery = useQuery({
    queryKey: ['projectPhotos', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('photos').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, uri: r.uri as string,
              timestamp: r.timestamp as string, location: r.location as string | undefined,
              tag: r.tag as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              linkedTaskName: r.linked_task_name as string | undefined,
              markup: (r.markup as ProjectPhoto['markup']) ?? [], createdAt: r.created_at as string,
            })) as ProjectPhoto[];
            await saveLocal(PHOTOS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<ProjectPhoto[]>(PHOTOS_KEY, []);
    },
  });

  const priceAlertsQuery = useQuery({
    queryKey: ['priceAlerts', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('price_alerts').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, materialId: r.material_id as string, materialName: r.material_name as string,
              targetPrice: Number(r.target_price), direction: (r.direction as PriceAlert['direction']) ?? 'below',
              currentPrice: Number(r.current_price), isTriggered: (r.is_triggered as boolean) ?? false,
              isPaused: (r.is_paused as boolean) ?? false, createdAt: r.created_at as string,
            })) as PriceAlert[];
            await saveLocal(PRICE_ALERTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PriceAlert[]>(PRICE_ALERTS_KEY, []);
    },
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, firstName: r.first_name as string, lastName: (r.last_name as string) ?? '',
              companyName: (r.company_name as string) ?? '', role: (r.role as Contact['role']) ?? 'Other',
              email: (r.email as string) ?? '', secondaryEmail: r.secondary_email as string | undefined,
              phone: (r.phone as string) ?? '', address: (r.address as string) ?? '', notes: (r.notes as string) ?? '',
              linkedProjectIds: (r.linked_project_ids as string[]) ?? [],
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Contact[];
            await saveLocal(CONTACTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Contact[]>(CONTACTS_KEY, []);
    },
  });

  const commEventsQuery = useQuery({
    queryKey: ['commEvents', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('comm_events').select('*').order('timestamp', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, type: r.type as CommunicationEvent['type'],
              summary: (r.summary as string) ?? '', actor: (r.actor as string) ?? '',
              recipient: r.recipient as string | undefined, detail: r.detail as string | undefined,
              isPrivate: (r.is_private as boolean) ?? false, timestamp: r.timestamp as string,
            })) as CommunicationEvent[];
            await saveLocal(COMM_EVENTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<CommunicationEvent[]>(COMM_EVENTS_KEY, []);
    },
  });

  const rfisQuery = useQuery({
    queryKey: ['rfis', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('rfis').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              subject: r.subject as string, question: (r.question as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', assignedTo: (r.assigned_to as string) ?? '',
              dateSubmitted: r.date_submitted as string, dateRequired: r.date_required as string,
              dateResponded: r.date_responded as string | undefined, response: r.response as string | undefined,
              status: (r.status as RFI['status']) ?? 'open', priority: (r.priority as RFI['priority']) ?? 'normal',
              linkedDrawing: r.linked_drawing as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              attachments: (r.attachments as string[]) ?? [], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as RFI[];
            await saveLocal(RFIS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<RFI[]>(RFIS_KEY, []);
    },
  });

  const submittalsQuery = useQuery({
    queryKey: ['submittals', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('submittals').select('*').order('created_at', { ascending: false });
          if (!error && data) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              title: r.title as string, specSection: (r.spec_section as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', submittedDate: r.submitted_date as string,
              requiredDate: r.required_date as string, reviewCycles: (r.review_cycles as Submittal['reviewCycles']) ?? [],
              currentStatus: (r.current_status as Submittal['currentStatus']) ?? 'pending',
              attachments: (r.attachments as string[]) ?? [], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Submittal[];
            await saveLocal(SUBMITTALS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Submittal[]>(SUBMITTALS_KEY, []);
    },
  });

  const equipmentQuery = useQuery({
    queryKey: ['equipment', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('equipment').select('*').order('created_at', { ascending: false });
          if (!error && data) {
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
            await saveLocal(EQUIPMENT_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
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
    if (canSync) {
      try { await supabase.from('profiles').update({ onboarding_complete: true }).eq('id', userId); } catch { /* ok */ }
    }
  }, [queryClient, userId, canSync]);

  useEffect(() => { if (projectsQuery.data) setProjects(projectsQuery.data); }, [projectsQuery.data]);
  useEffect(() => { if (settingsQuery.data) setSettings(settingsQuery.data); }, [settingsQuery.data]);
  useEffect(() => { if (changeOrdersQuery.data) setChangeOrders(changeOrdersQuery.data); }, [changeOrdersQuery.data]);
  useEffect(() => { if (invoicesQuery.data) setInvoices(invoicesQuery.data); }, [invoicesQuery.data]);
  useEffect(() => { if (commitmentsQuery.data) setCommitments(commitmentsQuery.data); }, [commitmentsQuery.data]);
  useEffect(() => { if (prequalQuery.data) setPrequalPackets(prequalQuery.data); }, [prequalQuery.data]);
  useEffect(() => { if (dailyReportsQuery.data) setDailyReports(dailyReportsQuery.data); }, [dailyReportsQuery.data]);
  useEffect(() => { if (subsQuery.data) setSubcontractors(subsQuery.data); }, [subsQuery.data]);
  useEffect(() => { if (punchItemsQuery.data) setPunchItems(punchItemsQuery.data); }, [punchItemsQuery.data]);
  useEffect(() => { if (photosQuery.data) setProjectPhotos(photosQuery.data); }, [photosQuery.data]);
  useEffect(() => { if (priceAlertsQuery.data) setPriceAlerts(priceAlertsQuery.data); }, [priceAlertsQuery.data]);
  useEffect(() => { if (contactsQuery.data) setContacts(contactsQuery.data); }, [contactsQuery.data]);
  useEffect(() => { if (commEventsQuery.data) setCommEvents(commEventsQuery.data); }, [commEventsQuery.data]);
  useEffect(() => { if (rfisQuery.data) setRfis(rfisQuery.data); }, [rfisQuery.data]);
  useEffect(() => { if (submittalsQuery.data) setSubmittals(submittalsQuery.data); }, [submittalsQuery.data]);
  useEffect(() => { if (equipmentQuery.data) setEquipment(equipmentQuery.data); }, [equipmentQuery.data]);

  // Permits — local-only persistence for now. The marketing claim is "track
  // permits"; we don't yet have a permits table in Supabase, so we store
  // entirely on-device. If we later add cloud sync, mirror the rfis pattern.
  const permitsQuery = useQuery({
    queryKey: ['permits', userId],
    queryFn: async () => loadLocal<Permit[]>(PERMITS_KEY, []),
  });
  useEffect(() => { if (permitsQuery.data) setPermits(permitsQuery.data); }, [permitsQuery.data]);
  const savePermitsMutation = useMutation({
    mutationFn: async (updated: Permit[]) => { await saveLocal(PERMITS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['permits', userId], data); },
  });

  // AIA G702/G703 pay applications — local-only. Saved when the GC taps
  // "Save to Project" on the pay-app screen. Surfaced in the client portal
  // as a dedicated "Pay Applications" section so the client/architect/lender
  // can review and download a PDF of every certified billing.
  const aiaPayAppsQuery = useQuery({
    queryKey: ['aiaPayApps', userId],
    queryFn: async () => loadLocal<SavedAIAPayApp[]>(AIA_PAY_APPS_KEY, []),
  });
  useEffect(() => { if (aiaPayAppsQuery.data) setAiaPayApps(aiaPayAppsQuery.data); }, [aiaPayAppsQuery.data]);
  const saveAiaPayAppsMutation = useMutation({
    mutationFn: async (updated: SavedAIAPayApp[]) => { await saveLocal(AIA_PAY_APPS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['aiaPayApps', userId], data); },
  });

  const syncProjectToSupabase = useCallback((project: Project, action: 'upsert' | 'delete') => {
    if (!canSync) return;
    const existing = syncDebounceMap.current.get(project.id);
    if (existing) clearTimeout(existing);
    syncDebounceMap.current.set(project.id, setTimeout(async () => {
      syncDebounceMap.current.delete(project.id);
      if (action === 'delete') {
        await supabaseWrite('projects', 'delete', { id: project.id });
      } else {
        await supabaseWrite('projects', 'insert', {
          id: project.id, user_id: userId, name: project.name, type: project.type,
          location: project.location, square_footage: project.squareFootage, quality: project.quality,
          description: project.description, estimate: project.estimate as unknown, schedule: project.schedule as unknown,
          linked_estimate: project.linkedEstimate as unknown, status: project.status,
          collaborators: project.collaborators as unknown, client_portal: project.clientPortal as unknown,
          target_budget: project.targetBudget as unknown,
          closed_at: project.closedAt, photo_count: project.photoCount,
          created_at: project.createdAt, updated_at: project.updatedAt,
        });
      }
      console.log('[ProjectContext] Synced project to Supabase:', project.name);
    }, 800));
  }, [canSync, userId]);

  const saveProjectsMutation = useMutation({
    mutationFn: async (updatedProjects: Project[]) => { await saveLocal(PROJECTS_KEY, updatedProjects); return updatedProjects; },
    onSuccess: (data) => { queryClient.setQueryData(['projects', userId], data); },
  });
  const saveChangeOrdersMutation = useMutation({
    mutationFn: async (updated: ChangeOrder[]) => { await saveLocal(CHANGE_ORDERS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['changeOrders', userId], data); },
  });
  const saveInvoicesMutation = useMutation({
    mutationFn: async (updated: Invoice[]) => { await saveLocal(INVOICES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['invoices', userId], data); },
  });
  const saveCommitmentsMutation = useMutation({
    mutationFn: async (updated: Commitment[]) => { await saveLocal(COMMITMENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['commitments', userId], data); },
  });
  const savePrequalMutation = useMutation({
    mutationFn: async (updated: PrequalPacket[]) => { await saveLocal(PREQUAL_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['prequalPackets', userId], data); },
  });
  const saveDailyReportsMutation = useMutation({
    mutationFn: async (updated: DailyFieldReport[]) => { await saveLocal(DAILY_REPORTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['dailyReports', userId], data); },
  });
  const saveSubsMutation = useMutation({
    mutationFn: async (updated: Subcontractor[]) => { await saveLocal(SUBS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['subcontractors', userId], data); },
  });
  const savePunchItemsMutation = useMutation({
    mutationFn: async (updated: PunchItem[]) => { await saveLocal(PUNCH_ITEMS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['punchItems', userId], data); },
  });
  const savePhotosMutation = useMutation({
    mutationFn: async (updated: ProjectPhoto[]) => { await saveLocal(PHOTOS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['projectPhotos', userId], data); },
  });
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
  const saveRfisMutation = useMutation({
    mutationFn: async (updated: RFI[]) => { await saveLocal(RFIS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['rfis', userId], data); },
  });
  const saveSubmittalsMutation = useMutation({
    mutationFn: async (updated: Submittal[]) => { await saveLocal(SUBMITTALS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['submittals', userId], data); },
  });
  const saveEquipmentMutation = useMutation({
    mutationFn: async (updated: Equipment[]) => { await saveLocal(EQUIPMENT_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['equipment', userId], data); },
  });
  const saveSettingsMutation = useMutation({
    mutationFn: async (updatedSettings: AppSettings) => {
      await saveLocal(SETTINGS_KEY, updatedSettings);
      if (canSync) {
        try {
          await supabase.from('profiles').update({
            location: updatedSettings.location, units: updatedSettings.units,
            tax_rate: updatedSettings.taxRate, contingency_rate: updatedSettings.contingencyRate,
            company_name: updatedSettings.branding.companyName, contact_name: updatedSettings.branding.contactName,
            email: updatedSettings.branding.email, phone: updatedSettings.branding.phone,
            address: updatedSettings.branding.address, license_number: updatedSettings.branding.licenseNumber,
            tagline: updatedSettings.branding.tagline, logo_uri: updatedSettings.branding.logoUri,
            signature_data: updatedSettings.branding.signatureData, theme_colors: updatedSettings.themeColors,
            biometrics_enabled: updatedSettings.biometricsEnabled, dfr_recipients: updatedSettings.dfrRecipients,
          }).eq('id', userId);
        } catch (err) { console.log('[ProjectContext] Settings sync failed:', err); }
      }
      return updatedSettings;
    },
    onSuccess: (data) => { queryClient.setQueryData(['settings', userId], data); },
  });

  const addProject = useCallback((project: Project) => {
    const updated = [project, ...projects];
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    syncProjectToSupabase(project, 'upsert');
  }, [projects, saveProjectsMutation, syncProjectToSupabase]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const updated = projects.map(p => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p);
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    const proj = updated.find(p => p.id === id);
    if (proj) syncProjectToSupabase(proj, 'upsert');
  }, [projects, saveProjectsMutation, syncProjectToSupabase]);

  const deleteProject = useCallback((id: string) => {
    const toDelete = projects.find(p => p.id === id);
    const updated = projects.filter(p => p.id !== id);
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    if (toDelete) syncProjectToSupabase(toDelete, 'delete');
  }, [projects, saveProjectsMutation, syncProjectToSupabase]);

  const getProject = useCallback((id: string) => projects.find(p => p.id === id) ?? null, [projects]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    saveSettingsMutation.mutate(updated);
  }, [settings, saveSettingsMutation]);

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

  const addChangeOrder = useCallback((co: ChangeOrder) => {
    const updated = [co, ...changeOrders];
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('change_orders', 'insert', {
        id: co.id, user_id: userId, project_id: co.projectId, number: co.number, date: co.date,
        description: co.description, reason: co.reason, line_items: co.lineItems, original_contract_value: co.originalContractValue,
        change_amount: co.changeAmount, new_contract_total: co.newContractTotal, status: co.status,
        approvers: co.approvers, approval_mode: co.approvalMode, approval_deadline_days: co.approvalDeadlineDays,
        audit_trail: co.auditTrail, revision: co.revision, created_at: co.createdAt, updated_at: co.updatedAt,
      });
    }
  }, [changeOrders, saveChangeOrdersMutation, canSync, userId]);

  const updateChangeOrder = useCallback((id: string, updates: Partial<ChangeOrder>) => {
    const now = new Date().toISOString();
    const prior = changeOrders.find(c => c.id === id);
    const updated = changeOrders.map(co => co.id === id ? { ...co, ...updates, updatedAt: now } : co);
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);

    // Cascade: when a CO transitions to 'approved', push its schedule impact
    // onto the linked project's schedule exactly once. The `scheduleImpactApplied`
    // flag guards against double-applying if the CO gets toggled approved→draft→approved.
    const nextCO = updated.find(c => c.id === id);
    const transitionedToApproved =
      !!nextCO &&
      nextCO.status === 'approved' &&
      prior?.status !== 'approved' &&
      !nextCO.scheduleImpactApplied &&
      (nextCO.scheduleImpactDays ?? 0) > 0;

    if (transitionedToApproved && nextCO) {
      // 1. Bump the project schedule's totalDurationDays + criticalPathDays.
      const project = projects.find(p => p.id === nextCO.projectId);
      if (project?.schedule) {
        const bumpDays = nextCO.scheduleImpactDays ?? 0;
        const newSchedule = {
          ...project.schedule,
          totalDurationDays: project.schedule.totalDurationDays + bumpDays,
          criticalPathDays: project.schedule.criticalPathDays + bumpDays,
          updatedAt: now,
        };
        const nextProjects = projects.map(p => p.id === nextCO.projectId ? { ...p, schedule: newSchedule, updatedAt: now } : p);
        setProjects(nextProjects);
        saveProjectsMutation.mutate(nextProjects);
        const proj = nextProjects.find(p => p.id === nextCO.projectId);
        if (proj) syncProjectToSupabase(proj, 'upsert');
        console.log('[CO cascade] Extended project', nextCO.projectId, 'schedule by', bumpDays, 'days');
      }

      // 2. Mark the CO's schedule impact as applied so we never double-apply.
      const finalCOs = updated.map(co => co.id === id ? { ...co, scheduleImpactApplied: true } : co);
      setChangeOrders(finalCOs);
      saveChangeOrdersMutation.mutate(finalCOs);
    }

    if (canSync) {
      const co = (transitionedToApproved ? { ...nextCO!, scheduleImpactApplied: true } : nextCO);
      if (co) {
        void supabaseWrite('change_orders', 'update', {
          id, description: co.description, reason: co.reason, line_items: co.lineItems,
          original_contract_value: co.originalContractValue, change_amount: co.changeAmount,
          new_contract_total: co.newContractTotal, status: co.status, approvers: co.approvers,
          audit_trail: co.auditTrail, revision: co.revision, updated_at: now,
          schedule_impact_days: co.scheduleImpactDays, schedule_impact_applied: co.scheduleImpactApplied,
        });
      }
    }
  }, [changeOrders, projects, saveChangeOrdersMutation, saveProjectsMutation, syncProjectToSupabase, canSync]);

  const getChangeOrdersForProject = useCallback((projectId: string) => {
    return changeOrders.filter(co => co.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [changeOrders]);

  const addInvoice = useCallback((invoice: Invoice) => {
    const updated = [invoice, ...invoices];
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('invoices', 'insert', {
        id: invoice.id, user_id: userId, project_id: invoice.projectId, number: invoice.number,
        type: invoice.type, progress_percent: invoice.progressPercent, issue_date: invoice.issueDate,
        due_date: invoice.dueDate, payment_terms: invoice.paymentTerms, notes: invoice.notes,
        line_items: invoice.lineItems, subtotal: invoice.subtotal, tax_rate: invoice.taxRate,
        tax_amount: invoice.taxAmount, total_due: invoice.totalDue, amount_paid: invoice.amountPaid,
        status: invoice.status, payments: invoice.payments, created_at: invoice.createdAt, updated_at: invoice.updatedAt,
      });
    }
  }, [invoices, saveInvoicesMutation, canSync, userId]);

  const updateInvoice = useCallback((id: string, updates: Partial<Invoice>) => {
    const now = new Date().toISOString();
    const updated = invoices.map(inv => inv.id === id ? { ...inv, ...updates, updatedAt: now } : inv);
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      const inv = updated.find(i => i.id === id);
      if (inv) {
        void supabaseWrite('invoices', 'update', {
          id, notes: inv.notes, line_items: inv.lineItems, subtotal: inv.subtotal, tax_rate: inv.taxRate,
          tax_amount: inv.taxAmount, total_due: inv.totalDue, amount_paid: inv.amountPaid,
          status: inv.status, payments: inv.payments, updated_at: now,
        });
      }
    }
  }, [invoices, saveInvoicesMutation, canSync]);

  const getInvoicesForProject = useCallback((projectId: string) => invoices.filter(inv => inv.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [invoices]);
  const getTotalOutstandingBalance = useCallback(() => invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'draft').reduce((sum, inv) => sum + (inv.totalDue - inv.amountPaid), 0), [invoices]);

  // Commitments — signed sub contracts and POs. Core data for the job
  // costing dashboard (see utils/jobCostEngine.ts). Stored locally only;
  // no Supabase sync yet because the `commitments` table hasn't been
  // migrated. Offline-first writes still work through the same pattern.
  const addCommitment = useCallback((c: Commitment) => {
    const updated = [c, ...commitments];
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
  }, [commitments, saveCommitmentsMutation]);

  const updateCommitment = useCallback((id: string, updates: Partial<Commitment>) => {
    const now = new Date().toISOString();
    const updated = commitments.map(c => c.id === id ? { ...c, ...updates, updatedAt: now } : c);
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
  }, [commitments, saveCommitmentsMutation]);

  const deleteCommitment = useCallback((id: string) => {
    const updated = commitments.filter(c => c.id !== id);
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
  }, [commitments, saveCommitmentsMutation]);

  const getCommitmentsForProject = useCallback(
    (projectId: string) => commitments.filter(c => c.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [commitments],
  );

  // Prequal packets — one per sub. We key packet lookup by sub id AND by
  // magic-link token (sub side) so the public route can resolve without
  // auth. Upsert semantics: re-submitting a packet overwrites the prior.
  const upsertPrequalPacket = useCallback((packet: PrequalPacket) => {
    const updated = prequalPackets.some(p => p.id === packet.id)
      ? prequalPackets.map(p => p.id === packet.id ? packet : p)
      : [packet, ...prequalPackets];
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
  }, [prequalPackets, savePrequalMutation]);

  const deletePrequalPacket = useCallback((id: string) => {
    const updated = prequalPackets.filter(p => p.id !== id);
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
  }, [prequalPackets, savePrequalMutation]);

  const getPrequalPacketForSub = useCallback(
    (subId: string) => prequalPackets.find(p => p.subcontractorId === subId) ?? null,
    [prequalPackets],
  );

  const getPrequalPacketByToken = useCallback(
    (token: string) => prequalPackets.find(p => p.inviteToken === token) ?? null,
    [prequalPackets],
  );

  const addDailyReport = useCallback((report: DailyFieldReport) => {
    const updated = [report, ...dailyReports];
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('daily_reports', 'insert', {
        id: report.id, user_id: userId, project_id: report.projectId, date: report.date,
        weather: report.weather, manpower: report.manpower, work_performed: report.workPerformed,
        materials_delivered: report.materialsDelivered, issues_and_delays: report.issuesAndDelays,
        photos: report.photos, status: report.status, created_at: report.createdAt, updated_at: report.updatedAt,
      });
    }
  }, [dailyReports, saveDailyReportsMutation, canSync, userId]);

  const updateDailyReport = useCallback((id: string, updates: Partial<DailyFieldReport>) => {
    const now = new Date().toISOString();
    const updated = dailyReports.map(dr => dr.id === id ? { ...dr, ...updates, updatedAt: now } : dr);
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    if (canSync) {
      const dr = updated.find(d => d.id === id);
      if (dr) {
        void supabaseWrite('daily_reports', 'update', {
          id, weather: dr.weather, manpower: dr.manpower, work_performed: dr.workPerformed,
          materials_delivered: dr.materialsDelivered, issues_and_delays: dr.issuesAndDelays,
          photos: dr.photos, status: dr.status, updated_at: now,
        });
      }
    }
  }, [dailyReports, saveDailyReportsMutation, canSync]);

  const getDailyReportsForProject = useCallback((projectId: string) => dailyReports.filter(dr => dr.projectId === projectId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [dailyReports]);

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
      });
    }
  }, [subcontractors, saveSubsMutation, canSync, userId]);

  const updateSubcontractor = useCallback((id: string, updates: Partial<Subcontractor>) => {
    const now = new Date().toISOString();
    const updated = subcontractors.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('subcontractors', 'update', {
          id, company_name: s.companyName, contact_name: s.contactName, phone: s.phone, email: s.email,
          address: s.address, trade: s.trade, license_number: s.licenseNumber, license_expiry: s.licenseExpiry,
          coi_expiry: s.coiExpiry, w9_on_file: s.w9OnFile, bid_history: s.bidHistory,
          assigned_projects: s.assignedProjects, notes: s.notes, updated_at: now,
        });
      }
    }
  }, [subcontractors, saveSubsMutation, canSync]);

  const deleteSubcontractor = useCallback((id: string) => {
    const updated = subcontractors.filter(s => s.id !== id);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) void supabaseWrite('subcontractors', 'delete', { id });
  }, [subcontractors, saveSubsMutation, canSync]);

  const getSubcontractor = useCallback((id: string) => subcontractors.find(s => s.id === id) ?? null, [subcontractors]);

  const addPunchItem = useCallback((item: PunchItem) => {
    const updated = [item, ...punchItems];
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('punch_items', 'insert', {
        id: item.id, user_id: userId, project_id: item.projectId, description: item.description,
        location: item.location, assigned_sub: item.assignedSub, assigned_sub_id: item.assignedSubId,
        due_date: item.dueDate, priority: item.priority, status: item.status, photo_uri: item.photoUri,
        rejection_note: item.rejectionNote, closed_at: item.closedAt,
        created_at: item.createdAt, updated_at: item.updatedAt,
      });
    }
  }, [punchItems, savePunchItemsMutation, canSync, userId]);

  const updatePunchItem = useCallback((id: string, updates: Partial<PunchItem>) => {
    const now = new Date().toISOString();
    const updated = punchItems.map(pi => pi.id === id ? { ...pi, ...updates, updatedAt: now } : pi);
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) {
      const pi = updated.find(x => x.id === id);
      if (pi) {
        void supabaseWrite('punch_items', 'update', {
          id, description: pi.description, location: pi.location, assigned_sub: pi.assignedSub,
          due_date: pi.dueDate, priority: pi.priority, status: pi.status, photo_uri: pi.photoUri,
          rejection_note: pi.rejectionNote, closed_at: pi.closedAt, updated_at: now,
        });
      }
    }
  }, [punchItems, savePunchItemsMutation, canSync]);

  const deletePunchItem = useCallback((id: string) => {
    const updated = punchItems.filter(pi => pi.id !== id);
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) void supabaseWrite('punch_items', 'delete', { id });
  }, [punchItems, savePunchItemsMutation, canSync]);

  const getPunchItemsForProject = useCallback((projectId: string) => punchItems.filter(pi => pi.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [punchItems]);

  const addProjectPhoto = useCallback((photo: ProjectPhoto) => {
    const updated = [photo, ...projectPhotos];
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('photos', 'insert', {
        id: photo.id, user_id: userId, project_id: photo.projectId, uri: photo.uri,
        timestamp: photo.timestamp, location: photo.location, tag: photo.tag,
        linked_task_id: photo.linkedTaskId, linked_task_name: photo.linkedTaskName,
        markup: photo.markup, created_at: photo.createdAt,
      });
    }
  }, [projectPhotos, savePhotosMutation, canSync, userId]);

  const deleteProjectPhoto = useCallback((id: string) => {
    const updated = projectPhotos.filter(p => p.id !== id);
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) void supabaseWrite('photos', 'delete', { id });
  }, [projectPhotos, savePhotosMutation, canSync]);

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

  const addRFI = useCallback((rfi: Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => {
    const projectRfis = rfis.filter(r => r.projectId === rfi.projectId);
    const nextNumber = projectRfis.length > 0 ? Math.max(...projectRfis.map(r => r.number)) + 1 : 1;
    const now = new Date().toISOString();
    const newRfi: RFI = { ...rfi, id: generateUUID(), number: nextNumber, createdAt: now, updatedAt: now };
    const updated = [newRfi, ...rfis];
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('rfis', 'insert', {
        id: newRfi.id, user_id: userId, project_id: newRfi.projectId, number: newRfi.number,
        subject: newRfi.subject, question: newRfi.question, submitted_by: newRfi.submittedBy,
        assigned_to: newRfi.assignedTo, date_submitted: newRfi.dateSubmitted, date_required: newRfi.dateRequired,
        status: newRfi.status, priority: newRfi.priority, linked_drawing: newRfi.linkedDrawing,
        linked_task_id: newRfi.linkedTaskId, attachments: newRfi.attachments,
        created_at: now, updated_at: now,
      });
    }
  }, [rfis, saveRfisMutation, canSync, userId]);

  const updateRFI = useCallback((id: string, updates: Partial<RFI>) => {
    const now = new Date().toISOString();
    const updated = rfis.map(r => r.id === id ? { ...r, ...updates, updatedAt: now } : r);
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) {
      const r = updated.find(x => x.id === id);
      if (r) {
        void supabaseWrite('rfis', 'update', {
          id, subject: r.subject, question: r.question, assigned_to: r.assignedTo,
          date_responded: r.dateResponded, response: r.response, status: r.status,
          priority: r.priority, attachments: r.attachments, updated_at: now,
        });
      }
    }
  }, [rfis, saveRfisMutation, canSync]);

  const deleteRFI = useCallback((id: string) => {
    const updated = rfis.filter(r => r.id !== id);
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) void supabaseWrite('rfis', 'delete', { id });
  }, [rfis, saveRfisMutation, canSync]);

  const getRFIsForProject = useCallback((projectId: string) => rfis.filter(r => r.projectId === projectId).sort((a, b) => b.number - a.number), [rfis]);

  const addPermit = useCallback((permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newPermit: Permit = { ...permit, id: generateUUID(), createdAt: now, updatedAt: now };
    const updated = [newPermit, ...permits];
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    return newPermit;
  }, [permits, savePermitsMutation]);

  const updatePermit = useCallback((id: string, updates: Partial<Permit>) => {
    const now = new Date().toISOString();
    const updated = permits.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p);
    setPermits(updated);
    savePermitsMutation.mutate(updated);
  }, [permits, savePermitsMutation]);

  const deletePermit = useCallback((id: string) => {
    const updated = permits.filter(p => p.id !== id);
    setPermits(updated);
    savePermitsMutation.mutate(updated);
  }, [permits, savePermitsMutation]);

  const getPermitsForProject = useCallback((projectId: string) =>
    permits.filter(p => p.projectId === projectId).sort((a, b) => new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime()),
    [permits]);

  // AIA pay applications. addAIAPayApp accepts a preassembled SavedAIAPayApp
  // (built from the editing screen with computed totals) so the helper stays
  // simple — no SOV math here, just persistence + de-dupe by (projectId,
  // applicationNumber).
  const addAIAPayApp = useCallback((app: SavedAIAPayApp) => {
    const dedup = aiaPayApps.filter(a => !(a.projectId === app.projectId && a.applicationNumber === app.applicationNumber));
    const updated = [app, ...dedup];
    setAiaPayApps(updated);
    saveAiaPayAppsMutation.mutate(updated);
    return app;
  }, [aiaPayApps, saveAiaPayAppsMutation]);

  const deleteAIAPayApp = useCallback((id: string) => {
    const updated = aiaPayApps.filter(a => a.id !== id);
    setAiaPayApps(updated);
    saveAiaPayAppsMutation.mutate(updated);
  }, [aiaPayApps, saveAiaPayAppsMutation]);

  const getAIAPayAppsForProject = useCallback((projectId: string) =>
    aiaPayApps.filter(a => a.projectId === projectId).sort((a, b) => b.applicationNumber - a.applicationNumber),
    [aiaPayApps]);

  const addSubmittal = useCallback((sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => {
    const projectSubs = submittals.filter(s => s.projectId === sub.projectId);
    const nextNumber = projectSubs.length > 0 ? Math.max(...projectSubs.map(s => s.number)) + 1 : 1;
    const now = new Date().toISOString();
    const newSub: Submittal = { ...sub, id: generateUUID(), number: nextNumber, createdAt: now, updatedAt: now };
    const updated = [newSub, ...submittals];
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('submittals', 'insert', {
        id: newSub.id, user_id: userId, project_id: newSub.projectId, number: newSub.number,
        title: newSub.title, spec_section: newSub.specSection, submitted_by: newSub.submittedBy,
        submitted_date: newSub.submittedDate, required_date: newSub.requiredDate,
        review_cycles: newSub.reviewCycles, current_status: newSub.currentStatus,
        attachments: newSub.attachments, created_at: now, updated_at: now,
      });
    }
  }, [submittals, saveSubmittalsMutation, canSync, userId]);

  const updateSubmittal = useCallback((id: string, updates: Partial<Submittal>) => {
    const now = new Date().toISOString();
    const updated = submittals.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('submittals', 'update', {
          id, title: s.title, spec_section: s.specSection, review_cycles: s.reviewCycles,
          current_status: s.currentStatus, attachments: s.attachments, updated_at: now,
        });
      }
    }
  }, [submittals, saveSubmittalsMutation, canSync]);

  const deleteSubmittal = useCallback((id: string) => {
    const updated = submittals.filter(s => s.id !== id);
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) void supabaseWrite('submittals', 'delete', { id });
  }, [submittals, saveSubmittalsMutation, canSync]);

  const getSubmittalsForProject = useCallback((projectId: string) => submittals.filter(s => s.projectId === projectId).sort((a, b) => b.number - a.number), [submittals]);

  const addReviewCycle = useCallback((submittalId: string, cycle: Omit<SubmittalReviewCycle, 'cycleNumber'>) => {
    const sub = submittals.find(s => s.id === submittalId);
    if (!sub) return;
    const nextCycle = sub.reviewCycles.length + 1;
    const newCycle: SubmittalReviewCycle = { ...cycle, cycleNumber: nextCycle };
    updateSubmittal(submittalId, { reviewCycles: [...sub.reviewCycles, newCycle], currentStatus: cycle.status });
  }, [submittals, updateSubmittal]);

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

  // Warranties — local-only storage for now
  useEffect(() => {
    void loadLocal<Warranty[]>(WARRANTIES_KEY, []).then(setWarranties);
  }, []);

  const persistWarranties = useCallback((list: Warranty[]) => {
    setWarranties(list);
    void saveLocal(WARRANTIES_KEY, list);
  }, []);

  const computeWarrantyStatus = useCallback((w: Warranty): Warranty['status'] => {
    if (w.status === 'claimed' || w.status === 'void') return w.status;
    const end = new Date(w.endDate).getTime();
    const now = Date.now();
    if (end < now) return 'expired';
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysLeft = Math.ceil((end - now) / msPerDay);
    const threshold = w.reminderDays ?? 30;
    if (daysLeft <= threshold) return 'expiring_soon';
    return 'active';
  }, []);

  const addWarranty = useCallback((w: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id?: string; status?: Warranty['status']; claims?: WarrantyClaim[] }) => {
    const now = new Date().toISOString();
    const fresh: Warranty = {
      id: w.id ?? `warr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now, updatedAt: now,
      status: w.status ?? 'active',
      claims: w.claims ?? [],
      ...w,
    } as Warranty;
    fresh.status = computeWarrantyStatus(fresh);
    persistWarranties([fresh, ...warranties]);
    return fresh;
  }, [warranties, persistWarranties, computeWarrantyStatus]);

  const updateWarranty = useCallback((id: string, updates: Partial<Warranty>) => {
    const now = new Date().toISOString();
    const next = warranties.map(w => {
      if (w.id !== id) return w;
      const merged = { ...w, ...updates, updatedAt: now };
      merged.status = computeWarrantyStatus(merged);
      return merged;
    });
    persistWarranties(next);
  }, [warranties, persistWarranties, computeWarrantyStatus]);

  const deleteWarranty = useCallback((id: string) => {
    persistWarranties(warranties.filter(w => w.id !== id));
  }, [warranties, persistWarranties]);

  const getWarrantiesForProject = useCallback((projectId: string) =>
    warranties.filter(w => w.projectId === projectId).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()),
    [warranties]);

  const addWarrantyClaim = useCallback((warrantyId: string, claim: Omit<WarrantyClaim, 'id'>) => {
    const id = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newClaim: WarrantyClaim = { id, ...claim };
    const next = warranties.map(w => w.id === warrantyId ? { ...w, claims: [newClaim, ...(w.claims ?? [])], updatedAt: new Date().toISOString() } : w);
    persistWarranties(next);
  }, [warranties, persistWarranties]);

  // Portal messages — client ↔ GC Q&A thread, local-only storage.
  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([]);

  useEffect(() => {
    void loadLocal<PortalMessage[]>(PORTAL_MESSAGES_KEY, []).then(setPortalMessages);
  }, []);

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
    const next = portalMessages.map(m => {
      if (m.projectId !== projectId) return m;
      if (side === 'gc' && m.authorType === 'client' && !m.readByGc) return { ...m, readByGc: true };
      if (side === 'client' && m.authorType === 'gc' && !m.readByClient) return { ...m, readByClient: true };
      return m;
    });
    persistPortalMessages(next);
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
  const [drawingPins, setDrawingPins] = useState<DrawingPin[]>([]);
  const [planMarkups, setPlanMarkups] = useState<PlanMarkup[]>([]);
  const [planCalibrations, setPlanCalibrations] = useState<PlanCalibration[]>([]);

  useEffect(() => {
    void loadLocal<PlanSheet[]>(PLAN_SHEETS_KEY, []).then(setPlanSheets);
    void loadLocal<DrawingPin[]>(DRAWING_PINS_KEY, []).then(setDrawingPins);
    void loadLocal<PlanMarkup[]>(PLAN_MARKUPS_KEY, []).then(setPlanMarkups);
    void loadLocal<PlanCalibration[]>(PLAN_CALIBRATIONS_KEY, []).then(setPlanCalibrations);
  }, []);

  const persistPlanSheets = useCallback((list: PlanSheet[]) => {
    setPlanSheets(list);
    void saveLocal(PLAN_SHEETS_KEY, list);
  }, []);
  const persistDrawingPins = useCallback((list: DrawingPin[]) => {
    setDrawingPins(list);
    void saveLocal(DRAWING_PINS_KEY, list);
  }, []);
  const persistPlanMarkups = useCallback((list: PlanMarkup[]) => {
    setPlanMarkups(list);
    void saveLocal(PLAN_MARKUPS_KEY, list);
  }, []);
  const persistPlanCalibrations = useCallback((list: PlanCalibration[]) => {
    setPlanCalibrations(list);
    void saveLocal(PLAN_CALIBRATIONS_KEY, list);
  }, []);

  const addPlanSheet = useCallback((sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: PlanSheet = {
      ...sheet,
      // UUID (not a prefixed timestamp) so the Supabase write path can
      // round-trip the id into a Postgres UUID column without rejection.
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    persistPlanSheets([fresh, ...planSheets]);
    if (canSync) {
      void supabaseWrite('plan_sheets', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        name: fresh.name, sheet_number: fresh.sheetNumber ?? null,
        image_uri: fresh.imageUri, page_number: fresh.pageNumber ?? null,
        width: fresh.width ?? null, height: fresh.height ?? null,
        created_at: fresh.createdAt, updated_at: fresh.updatedAt,
      });
    }
    return fresh;
  }, [planSheets, persistPlanSheets, canSync, userId]);

  const updatePlanSheet = useCallback((id: string, updates: Partial<PlanSheet>) => {
    const now = new Date().toISOString();
    persistPlanSheets(planSheets.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s));
    if (canSync) {
      // Only forward persisted columns — `projectId` is immutable after
      // creation, so we never write it on update.
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.sheetNumber !== undefined) patch.sheet_number = updates.sheetNumber;
      if (updates.imageUri !== undefined) patch.image_uri = updates.imageUri;
      if (updates.pageNumber !== undefined) patch.page_number = updates.pageNumber;
      if (updates.width !== undefined) patch.width = updates.width;
      if (updates.height !== undefined) patch.height = updates.height;
      void supabaseWrite('plan_sheets', 'update', { id, ...patch });
    }
  }, [planSheets, persistPlanSheets, canSync]);

  const deletePlanSheet = useCallback((id: string) => {
    persistPlanSheets(planSheets.filter(s => s.id !== id));
    // cascade: pins, markups, calibrations on that sheet.
    // Server side relies on ON DELETE CASCADE from plan_sheets — we only
    // need to issue the parent delete. Local state still needs the manual
    // fan-out because AsyncStorage doesn't have FK cascades.
    persistDrawingPins(drawingPins.filter(p => p.planSheetId !== id));
    persistPlanMarkups(planMarkups.filter(m => m.planSheetId !== id));
    persistPlanCalibrations(planCalibrations.filter(c => c.planSheetId !== id));
    if (canSync) void supabaseWrite('plan_sheets', 'delete', { id });
  }, [planSheets, drawingPins, planMarkups, planCalibrations, persistPlanSheets, persistDrawingPins, persistPlanMarkups, persistPlanCalibrations, canSync]);

  const getPlanSheetsForProject = useCallback((projectId: string) =>
    planSheets.filter(s => s.projectId === projectId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [planSheets]);

  const getPlanSheet = useCallback((id: string) => planSheets.find(s => s.id === id), [planSheets]);

  const addDrawingPin = useCallback((pin: Omit<DrawingPin, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: DrawingPin = {
      ...pin,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    persistDrawingPins([fresh, ...drawingPins]);
    if (canSync) {
      void supabaseWrite('drawing_pins', 'insert', {
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
  }, [drawingPins, persistDrawingPins, canSync, userId]);

  const updateDrawingPin = useCallback((id: string, updates: Partial<DrawingPin>) => {
    const now = new Date().toISOString();
    persistDrawingPins(drawingPins.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p));
    if (canSync) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.x !== undefined) patch.x = updates.x;
      if (updates.y !== undefined) patch.y = updates.y;
      if (updates.label !== undefined) patch.label = updates.label;
      if (updates.color !== undefined) patch.color = updates.color;
      if (updates.kind !== undefined) patch.kind = updates.kind;
      if (updates.linkedPhotoId !== undefined) patch.linked_photo_id = updates.linkedPhotoId;
      if (updates.linkedPunchItemId !== undefined) patch.linked_punch_item_id = updates.linkedPunchItemId;
      if (updates.linkedRfiId !== undefined) patch.linked_rfi_id = updates.linkedRfiId;
      void supabaseWrite('drawing_pins', 'update', { id, ...patch });
    }
  }, [drawingPins, persistDrawingPins, canSync]);

  const deleteDrawingPin = useCallback((id: string) => {
    persistDrawingPins(drawingPins.filter(p => p.id !== id));
    if (canSync) void supabaseWrite('drawing_pins', 'delete', { id });
  }, [drawingPins, persistDrawingPins, canSync]);

  const getPinsForPlan = useCallback((planSheetId: string) =>
    drawingPins.filter(p => p.planSheetId === planSheetId),
    [drawingPins]);

  const getPinsForPhoto = useCallback((photoId: string) =>
    drawingPins.filter(p => p.linkedPhotoId === photoId),
    [drawingPins]);

  const addPlanMarkup = useCallback((markup: Omit<PlanMarkup, 'id' | 'createdAt'>) => {
    const fresh: PlanMarkup = {
      ...markup,
      id: generateUUID(),
      createdAt: new Date().toISOString(),
    };
    persistPlanMarkups([fresh, ...planMarkups]);
    if (canSync) {
      void supabaseWrite('plan_markups', 'insert', {
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
    if (canSync) void supabaseWrite('plan_markups', 'delete', { id });
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
        // Server schema has a UNIQUE on plan_sheet_id, so the insert path
        // via `supabaseWrite` (which uses upsert) handles both create and
        // replace. Cheaper than branching to an update here.
        void supabaseWrite('plan_calibrations', 'insert', {
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
      void supabaseWrite('plan_calibrations', 'insert', {
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

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [projects]);

  return useMemo(() => ({
    projects: sortedProjects, settings, hasSeenOnboarding, completeOnboarding,
    isLoading: projectsQuery.isLoading || settingsQuery.isLoading || onboardingQuery.isLoading,
    addProject, updateProject, deleteProject, getProject, updateSettings,
    addCollaborator, removeCollaborator,
    changeOrders, addChangeOrder, updateChangeOrder, getChangeOrdersForProject,
    addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices,
    commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject,
    prequalPackets, upsertPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken,
    dailyReports, addDailyReport, updateDailyReport, getDailyReportsForProject,
    subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor,
    punchItems, addPunchItem, updatePunchItem, deletePunchItem, getPunchItemsForProject,
    projectPhotos, addProjectPhoto, deleteProjectPhoto, getPhotosForProject,
    priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert,
    contacts, addContact, updateContact, deleteContact, getContact,
    commEvents, addCommEvent, getCommEventsForProject,
    rfis, addRFI, updateRFI, deleteRFI, getRFIsForProject,
    permits, addPermit, updatePermit, deletePermit, getPermitsForProject,
    aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject,
    submittals, addSubmittal, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle,
    equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject,
    warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim,
    portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc,
    planSheets, addPlanSheet, updatePlanSheet, deletePlanSheet, getPlanSheetsForProject, getPlanSheet,
    drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto,
    planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan,
    planCalibrations, upsertPlanCalibration, getCalibrationForPlan,
  }), [sortedProjects, settings, hasSeenOnboarding, completeOnboarding, projectsQuery.isLoading, settingsQuery.isLoading, onboardingQuery.isLoading, addProject, updateProject, deleteProject, getProject, updateSettings, addCollaborator, removeCollaborator, changeOrders, addChangeOrder, updateChangeOrder, getChangeOrdersForProject, addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices, commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject, prequalPackets, upsertPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken, dailyReports, addDailyReport, updateDailyReport, getDailyReportsForProject, subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor, punchItems, addPunchItem, updatePunchItem, deletePunchItem, getPunchItemsForProject, projectPhotos, addProjectPhoto, deleteProjectPhoto, getPhotosForProject, priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, contacts, addContact, updateContact, deleteContact, getContact, commEvents, addCommEvent, getCommEventsForProject, rfis, addRFI, updateRFI, deleteRFI, getRFIsForProject, permits, addPermit, updatePermit, deletePermit, getPermitsForProject, aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject, submittals, addSubmittal, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle, equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject, warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim, portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc, planSheets, addPlanSheet, updatePlanSheet, deletePlanSheet, getPlanSheetsForProject, getPlanSheet, drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto, planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan, planCalibrations, upsertPlanCalibration, getCalibrationForPlan]);
});
