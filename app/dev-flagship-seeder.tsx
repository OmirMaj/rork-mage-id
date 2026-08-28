// app/dev-flagship-seeder.tsx — Owner-only FLAGSHIP demo seeder.
//
// Loads "The Overlook Estate" — a very complex, fully-populated, internally
// consistent $9.18M luxury hillside build, mid-construction (~52% complete),
// with EVERY feature filled start-to-finish so marketing/App-Store shots on
// iOS and web read as a real, live, healthy job to both contractors and
// property owners.
//
// This is the richer sibling of app/dev-seeder.tsx (the Westlake demo). It
// pulls its authored numbers from constants/flagshipProject.ts (which also
// exports a reusable schedule template) and writes through the SAME
// ProjectContext + SafetyContext adders + wave-engine helpers the app uses
// everywhere, so the data shows up on every screen on both surfaces.
//
// Owner-gated to OWNER_EMAILS (utils/owner.ts). Idempotent at the project
// level: each press creates a brand-new project id, so repeats don't collide.
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, Redirect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Gem, AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { isOwner } from '@/utils/owner';
import { generateUUID } from '@/utils/generateId';
import { nailIt } from '@/components/animations/NailItToast';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type {
  Project, Invoice, DailyFieldReport, DFRWorkProgress, PunchItem, ProjectPhoto, PhotoMarkup,
  ChangeOrder, LinkedEstimate, LinkedEstimateItem, ProjectSchedule, ScheduleTask,
  Permit, CodeFinding, Equipment, PortalMessage, Subcontractor, Contact,
  JobHazardAnalysis, ToolboxTalk, SafetyIncident, Hazard, SafetyInspection,
  Certification, InspectionItem,
} from '@/types';
import { saveContract } from '@/utils/contractEngine';
import {
  saveSelectionCategory, saveCuratedOptions, chooseSelectionOption, fetchSelectionsForProject,
} from '@/utils/selectionsEngine';
import type { CuratedOption } from '@/utils/selectionsEngine';
import { resolveSelectionImage } from '@/utils/ogImage';
import { saveLienWaiver } from '@/utils/lienWaiverEngine';
import { saveCloseoutBinder, DEFAULT_MAINTENANCE } from '@/utils/closeoutBinderEngine';
import { showAlert } from '@/utils/alert';
import {
  FLAGSHIP_IDENTITY, FLAGSHIP_ESTIMATE_ITEMS, FLAGSHIP_MARKUP_PCT, FLAGSHIP_TASKS,
  FLAGSHIP_START_DAYS_AGO, FLAGSHIP_CONTRACT_VALUE, FLAGSHIP_FEE_PERCENT,
} from '@/constants/flagshipProject';

export default function DevFlagshipSeederScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { user } = useAuth();
  const {
    addProject,
    addInvoice, addDailyReport, addPunchItem,
    addProjectPhoto, addRFI, addChangeOrder,
    addPermit, savePermitRoadmap,
    addPlanSheet, savePlanReview, addPlanZone,
    addWarranty, addWarrantyClaim,
    addSubmittal, addAIAPayApp, addEquipment,
    addCOI, addPortalMessage, addCommitment,
    addSubcontractor, addContact, addOACMeeting,
  } = useProjects();
  const { addJha, addToolboxTalk, addIncident, addHazard, addInspection, addCertification } = useSafety();

  const [seeding, setSeeding] = useState<boolean>(false);
  const ownerOk = isOwner(user?.email);

  const seed = useCallback(async () => {
    if (seeding) return;
    setSeeding(true);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const now = new Date();
      const projectId = generateUUID();
      const isoNow = now.toISOString();
      const dayMs = 24 * 60 * 60 * 1000;
      const isoDaysAgo = (n: number) => new Date(now.getTime() - n * dayMs).toISOString();
      const dateDaysAgo = (n: number) => isoDaysAgo(n).slice(0, 10);
      const authorName = ((user?.name && user.name.trim()) || user?.email || 'Site Super').trim();

      const START = FLAGSHIP_START_DAYS_AGO;
      const scheduleStartDate = dateDaysAgo(START);
      const CONTRACT = FLAGSHIP_CONTRACT_VALUE;

      // ─── 1. Linked estimate (54 SOV line items across CSI divisions) ────
      const estItems: LinkedEstimateItem[] = FLAGSHIP_ESTIMATE_ITEMS.map((s) => ({
        materialId: s.materialId,
        name: s.name,
        category: s.category,
        unit: s.unit,
        quantity: s.quantity,
        unitPrice: s.unitPrice,
        bulkPrice: s.unitPrice,
        markup: FLAGSHIP_MARKUP_PCT,
        usesBulk: false,
        lineTotal: Math.round(s.quantity * s.unitPrice),
        supplier: '',
        csiDivision: s.csiDivision,
        ...(s.isAllowance ? { isAllowance: true } : {}),
      }));
      const estBaseTotal = estItems.reduce((sum, i) => sum + i.lineTotal, 0);
      const markupTotal = Math.round(estBaseTotal * (FLAGSHIP_MARKUP_PCT / 100));
      const linkedEstimate: LinkedEstimate = {
        id: generateUUID(),
        items: estItems,
        globalMarkup: FLAGSHIP_MARKUP_PCT,
        baseTotal: estBaseTotal,
        markupTotal,
        grandTotal: estBaseTotal + markupTotal,
        createdAt: isoDaysAgo(START + 21),
      };

      // ─── 2. Schedule (42 tasks, baseline, critical path, risk items) ────
      const scheduleTasks: ScheduleTask[] = FLAGSHIP_TASKS.map((t) => ({
        id: t.id,
        title: t.title,
        phase: t.phase,
        durationDays: t.durationDays,
        startDay: t.startDay,
        progress: t.progress,
        crew: t.crew,
        crewSize: t.crewSize,
        dependencies: t.deps,
        notes: t.notes ?? '',
        rationale: t.rationale,
        status: t.progress >= 100 ? 'done' : t.progress > 0 ? 'in_progress' : 'not_started',
        isMilestone: t.milestone,
        isCriticalPath: t.critical,
        isWeatherSensitive: t.weather,
      }));
      const totalDuration = Math.max(...scheduleTasks.map((t) => t.startDay + t.durationDays));
      const schedule: ProjectSchedule = {
        id: generateUUID(),
        name: 'Master Schedule',
        projectId,
        startDate: scheduleStartDate,
        workingDaysPerWeek: 5,
        bufferDays: 15,
        tasks: scheduleTasks,
        totalDurationDays: totalDuration,
        criticalPathDays: totalDuration,
        laborAlignmentScore: 88,
        healthScore: 84,
        riskItems: [
          { id: generateUUID(), title: 'Imported curtain-wall lead time', detail: 'European structural-glass package on a 16-week lead — verify against interior dry-in so finishes are not gated.', severity: 'high' },
          { id: generateUUID(), title: 'Winter storm window for pool shell', detail: 'Negative-edge shell pour needs a 3-day dry window; watch the forecast on the hillside micro-climate.', severity: 'medium' },
          { id: generateUUID(), title: 'Millwork shop capacity', detail: 'Cabinetry shop is at capacity; confirm the release date holds so drywall → millwork handoff stays tight.', severity: 'low' },
        ],
        baseline: {
          savedAt: isoDaysAgo(START - 3),
          tasks: FLAGSHIP_TASKS.map((t) => ({
            id: t.id,
            startDay: t.startDay,
            endDay: t.startDay + t.durationDays - (t.baselineEndDelta ?? 0),
          })),
        },
        updatedAt: isoNow,
      };

      // ─── 3. The project ────────────────────────────────────────────────
      const portalId = `portal-${projectId.slice(0, 8)}-flagship`;
      const project = {
        id: projectId,
        name: FLAGSHIP_IDENTITY.name,
        type: FLAGSHIP_IDENTITY.type,
        location: FLAGSHIP_IDENTITY.location,
        squareFootage: FLAGSHIP_IDENTITY.squareFootage,
        quality: FLAGSHIP_IDENTITY.quality,
        description: FLAGSHIP_IDENTITY.description,
        primaryContact: { ...FLAGSHIP_IDENTITY.primaryContact },
        leadSource: 'referral',
        createdAt: isoDaysAgo(START + 30),
        updatedAt: isoNow,
        estimate: {
          materialTotal: Math.round(estBaseTotal * 0.56),
          laborTotal: Math.round(estBaseTotal * 0.44),
          permits: 64_800,
          overhead: Math.round(estBaseTotal * 0.06),
          contingency: Math.round(estBaseTotal * 0.05),
          taxAmount: 0,
          totalCost: estBaseTotal,
          markupPercent: FLAGSHIP_FEE_PERCENT,
          markupAmount: markupTotal,
          grandTotal: CONTRACT,
          pricePerSqFt: Math.round(CONTRACT / FLAGSHIP_IDENTITY.squareFootage),
          estimatedDuration: '16-17 months',
          materials: [],
        },
        status: 'in_progress',
        contractMode: 'gmp',
        gmpCap: CONTRACT,
        contractorFeePercent: FLAGSHIP_FEE_PERCENT,
        linkedEstimate,
        schedule,
        clientPortal: {
          enabled: true,
          portalId,
          showSchedule: true,
          showBudgetSummary: true,
          showInvoices: true,
          showChangeOrders: true,
          showPhotos: true,
          showDailyReports: true,
          showPunchList: true,
          showRFIs: true,
          showDocuments: true,
          welcomeMessage: FLAGSHIP_IDENTITY.clientPortalWelcome,
          coApprovalEnabled: true,
          clientCanSetBudget: false,
          homeownerLanguage: 'en',
          weeklyDigest: { enabled: true, hour: 16 },
          invites: [
            {
              id: generateUUID(),
              email: FLAGSHIP_IDENTITY.primaryContact.email,
              name: 'Priya Whitaker',
              status: 'viewed' as const,
              invitedAt: isoDaysAgo(START + 20),
              accessedAt: isoDaysAgo(1),
            },
          ],
        },
        handoverChecklist: {},
      } as unknown as Project;
      addProject(project);

      // ─── 4. Invoices — 9 progress bills w/ retention, mixed status ──────
      // 10% retention held throughout. Billing tracks the cost-weighted
      // completion (~55% of the $9.18M contract → ~$5.05M billed gross): the
      // expensive early spine is done, so early apps are large. The last two
      // apps are unpaid (sent + draft) so A/R has money in it. Each line ties
      // back to a real estimate SOV row via sourceEstimateItemId + billedPercent.
      const RETENTION_PCT = 10;
      const invoiceSeeds: {
        number: number; pct: number; issueAgo: number; dueAgo: number;
        paid: number; status: Invoice['status']; billItems: { id: string; pct: number }[];
      }[] = [
        { number: 1, pct: 8, issueAgo: 176, dueAgo: 146, paid: -1, status: 'paid', billItems: [{ id: 'li-genconds', pct: 25 }, { id: 'li-demo', pct: 100 }, { id: 'li-erosion', pct: 100 }, { id: 'li-shoring', pct: 100 }, { id: 'li-excav', pct: 40 }] },
        { number: 2, pct: 16, issueAgo: 150, dueAgo: 120, paid: -1, status: 'paid', billItems: [{ id: 'li-excav', pct: 60 }, { id: 'li-caissons', pct: 100 }, { id: 'li-utilities', pct: 100 }] },
        { number: 3, pct: 24, issueAgo: 122, dueAgo: 92, paid: -1, status: 'paid', billItems: [{ id: 'li-foundation', pct: 100 }, { id: 'li-waterproof', pct: 100 }, { id: 'li-board-formed', pct: 50 }] },
        { number: 4, pct: 33, issueAgo: 96, dueAgo: 66, paid: -1, status: 'paid', billItems: [{ id: 'li-board-formed', pct: 50 }, { id: 'li-steel', pct: 60 }, { id: 'li-mono-stair', pct: 40 }] },
        { number: 5, pct: 42, issueAgo: 68, dueAgo: 38, paid: -1, status: 'paid', billItems: [{ id: 'li-steel', pct: 40 }, { id: 'li-steel-misc', pct: 100 }, { id: 'li-framing', pct: 50 }] },
        { number: 6, pct: 50, issueAgo: 40, dueAgo: 10, paid: -1, status: 'paid', billItems: [{ id: 'li-framing', pct: 42 }, { id: 'li-roof', pct: 80 }, { id: 'li-plumbing', pct: 40 }] },
        { number: 7, pct: 55, issueAgo: 22, dueAgo: -8, paid: 300_000, status: 'partially_paid', billItems: [{ id: 'li-electrical', pct: 45 }, { id: 'li-hvac', pct: 38 }, { id: 'li-windows', pct: 45 }] },
        { number: 8, pct: 58, issueAgo: 6, dueAgo: -24, paid: 0, status: 'sent', billItems: [{ id: 'li-curtainwall', pct: 20 }, { id: 'li-radiant', pct: 40 }, { id: 'li-solar', pct: 30 }] },
        { number: 9, pct: 60, issueAgo: 0, dueAgo: -30, paid: 0, status: 'draft', billItems: [{ id: 'li-cladding', pct: 12 }, { id: 'li-fire', pct: 30 }, { id: 'li-smart-home', pct: 15 }] },
      ];
      for (const inv of invoiceSeeds) {
        const lineItems = inv.billItems.map((b) => {
          const src = estItems.find((e) => e.materialId === b.id);
          const amt = src ? Math.round(src.lineTotal * (1 + FLAGSHIP_MARKUP_PCT / 100) * (b.pct / 100)) : 0;
          return {
            id: generateUUID(),
            name: src?.name ?? 'Progress billing',
            description: `${src?.name ?? 'Work'} — ${b.pct}% this period`,
            quantity: 1,
            unit: 'lump',
            unitPrice: amt,
            total: amt,
            sourceEstimateItemId: b.id,
            billedPercent: b.pct,
          };
        });
        const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
        const retentionAmount = Math.round(subtotal * (RETENTION_PCT / 100));
        // paid === -1 sentinel means "collected in full, less retention".
        const amountPaid = inv.paid === -1 ? subtotal - retentionAmount : inv.paid;
        addInvoice({
          id: generateUUID(),
          projectId,
          number: inv.number,
          type: 'progress',
          progressPercent: inv.pct,
          issueDate: isoDaysAgo(inv.issueAgo),
          dueDate: isoDaysAgo(inv.dueAgo),
          paymentTerms: 'net_30',
          notes: `Progress Application No. ${inv.number} — work completed through ${inv.pct}% of contract. 10% retainage held.`,
          lineItems,
          subtotal,
          taxRate: 0,
          taxAmount: 0,
          totalDue: subtotal,
          amountPaid,
          status: inv.status,
          payments: amountPaid > 0
            ? [{ id: generateUUID(), date: isoDaysAgo(Math.max(inv.dueAgo, 0)), amount: amountPaid, method: 'ach' as const }]
            : [],
          retentionPercent: RETENTION_PCT,
          retentionAmount,
          retentionReleased: 0,
          retentionReleases: [],
          createdAt: isoDaysAgo(inv.issueAgo),
          updatedAt: isoNow,
        } as unknown as Invoice);
      }

      // ─── 5. Daily field reports — 12 over the last ~6 weeks ─────────────
      // Progress chips tie to real schedule task titles; weather realistic;
      // two carry a documented issue/delay; the most recent is published to
      // the portal so the homeowner "Latest update" hero renders.
      const dfrSeeds: {
        agoDays: number; temp: string; conditions: string; work: string; issues: string;
        crew: { trade: string; company: string; head: number; hrs: number }[];
        progress: { taskId: string; pct: number }[];
        materials: string[];
        homeowner: string;
      }[] = [
        {
          agoDays: 1, temp: '61°F', conditions: 'Clear', work: 'Curtain-wall unit setting continued on the west great-room elevation — 6 units set today, sequence tracking well. Electricians pulling home-runs to the main gear.', issues: '',
          crew: [{ trade: 'Glazing', company: 'Bayview Glass Systems', head: 6, hrs: 9 }, { trade: 'Electrical', company: 'Meridian Electric', head: 5, hrs: 8 }],
          progress: [{ taskId: 't-curtainwall', pct: 20 }, { taskId: 't-elec-rough', pct: 48 }],
          materials: ['Curtain-wall units — 6 crates', 'EMT & wire — pallet'],
          homeowner: 'Great news from the hill today — the big glass wall in the great room is going up, and you can finally start to feel how open that room is going to be. Six panels set today. The electricians are running the main wiring to the house at the same time. Sunny and calm, which is exactly what we want for glass work.',
        },
        {
          agoDays: 3, temp: '58°F', conditions: 'PartlyCloudy', work: 'HVAC crew set the two heat-pump air handlers in the mechanical room and started trunk duct in the ceiling. Plumbers pressure-tested the primary-wing rough.', issues: '',
          crew: [{ trade: 'Mechanical', company: 'Summit Mechanical', head: 6, hrs: 8 }, { trade: 'Plumbing', company: 'Cascade Plumbing', head: 4, hrs: 8 }],
          progress: [{ taskId: 't-hvac-rough', pct: 40 }, { taskId: 't-plumb-rough', pct: 55 }],
          materials: ['Heat-pump air handlers — 2', 'Ductwork — trailer'],
          homeowner: 'The heating-and-cooling equipment landed and is now in place in the mechanical room — this is the all-electric heat-pump system with fresh-air recovery we spec\'d. Plumbers pressure-tested the primary-suite lines and everything held. Steady progress.',
        },
        {
          agoDays: 4, temp: '55°F', conditions: 'Cloudy', work: 'Roofers finished the standing-seam field on the main roof; only the pool-house edge metal remains. Framers topped out the feature-stair opening.', issues: '',
          crew: [{ trade: 'Roofing', company: 'Ridgeline Roofing', head: 6, hrs: 8 }, { trade: 'Carpentry', company: 'Anderson Framing', head: 8, hrs: 9 }],
          progress: [{ taskId: 't-roof', pct: 88 }, { taskId: 't-framing', pct: 92 }],
          materials: ['Standing-seam panels — final lift'],
          homeowner: 'The main roof is essentially done — the standing-seam metal looks fantastic. Framers finished the opening for your floating staircase, which is going to be a showpiece. We\'re weather-tight over the main house now.',
        },
        {
          agoDays: 7, temp: '52°F', conditions: 'Rain', work: 'Rain day — interior work only. Fire-sprinkler crew ran branch lines on the lower level. Low-voltage crew pulled AV and network backbone.', issues: 'Half-day rain delay on exterior cladding; cladding crew redeployed indoors, no schedule impact.',
          crew: [{ trade: 'Fire', company: 'Guardian Fire Protection', head: 3, hrs: 6 }, { trade: 'AV', company: 'Loop Smart Homes', head: 4, hrs: 8 }],
          progress: [{ taskId: 't-fire-rough', pct: 30 }, { taskId: 't-lowvolt', pct: 15 }],
          materials: ['Sprinkler pipe — bundle', 'Cat6A & fiber — spools'],
          homeowner: 'Rainy day, so we kept the crews inside and made good use of it — fire-sprinkler lines went in downstairs and the smart-home wiring backbone got pulled. The rain pushed the exterior cladding a half-day, but we moved that crew indoors so the overall schedule is unaffected.',
        },
        {
          agoDays: 9, temp: '57°F', conditions: 'Clear', work: 'Curtain-wall install began on the great room. Elevator car and rails set. Radiant-floor manifolds mounted in the mechanical room.', issues: '',
          crew: [{ trade: 'Glazing', company: 'Bayview Glass Systems', head: 6, hrs: 9 }, { trade: 'Elevator', company: 'Peninsula Elevator', head: 2, hrs: 8 }],
          progress: [{ taskId: 't-curtainwall', pct: 8 }, { taskId: 't-mono-stair', pct: 60 }],
          materials: ['Elevator car & rails'],
          homeowner: 'Big milestone — the structural glass wall started going in, and the elevator car is now in the shaft. The radiant floor-heating manifolds are mounted too, so warm floors are on the way.',
        },
        {
          agoDays: 11, temp: '60°F', conditions: 'Clear', work: 'Windows and lift-slide doors set on the south elevation. Electricians rough-wired the primary wing and wine cellar.', issues: '',
          crew: [{ trade: 'Glazing', company: 'Bayview Glass Systems', head: 5, hrs: 8 }, { trade: 'Electrical', company: 'Meridian Electric', head: 6, hrs: 8 }],
          progress: [{ taskId: 't-windows', pct: 45 }, { taskId: 't-elec-rough', pct: 42 }],
          materials: ['Lift-slide door units — 4'],
          homeowner: 'The big sliding glass doors on the south side are in — the indoor/outdoor flow to the terrace is really coming together. Electricians wired the primary suite and the wine cellar today.',
        },
        {
          agoDays: 14, temp: '54°F', conditions: 'Cloudy', work: 'Cladding crew started the Cor-ten rainscreen on the north wall. Plumbers set tubs and shower pans in the upper baths.', issues: '',
          crew: [{ trade: 'Cladding', company: 'Facade Works', head: 5, hrs: 8 }, { trade: 'Plumbing', company: 'Cascade Plumbing', head: 4, hrs: 8 }],
          progress: [{ taskId: 't-cladding', pct: 12 }, { taskId: 't-plumb-rough', pct: 48 }],
          materials: ['Cor-ten panels — first lift', 'Tubs & shower pans — 5'],
          homeowner: 'The exterior weathering-steel siding started on the north wall — it\'ll develop that rich patina over time. Upstairs, the tubs and shower bases are being set.',
        },
        {
          agoDays: 16, temp: '59°F', conditions: 'Clear', work: 'HVAC trunk duct completed on the main level. Framers hung the last of the interior partitions; ready for MEP inspection prep.', issues: '',
          crew: [{ trade: 'Mechanical', company: 'Summit Mechanical', head: 6, hrs: 8 }, { trade: 'Carpentry', company: 'Anderson Framing', head: 6, hrs: 8 }],
          progress: [{ taskId: 't-hvac-rough', pct: 34 }, { taskId: 't-framing', pct: 88 }],
          materials: [],
          homeowner: 'Ductwork on the main floor is wrapped up and the interior walls are all framed. We\'re getting the house ready for the rough inspections that let us close up the walls.',
        },
        {
          agoDays: 18, temp: '56°F', conditions: 'Clear', work: 'Feature staircase stringers set and welded. Solar mounting rails installed on the main roof.', issues: '',
          crew: [{ trade: 'Steel', company: 'Ironline Structural', head: 4, hrs: 9 }, { trade: 'Solar', company: 'Sunhill Energy', head: 3, hrs: 8 }],
          progress: [{ taskId: 't-mono-stair', pct: 40 }, { taskId: 't-roof', pct: 80 }],
          materials: ['Stair stringers', 'Solar rail & flashing'],
          homeowner: 'Your floating staircase\'s steel spine is up and welded — impressive to see. And the mounting for the rooftop solar array is installed, so the panels come next.',
        },
        {
          agoDays: 21, temp: '50°F', conditions: 'Rain', work: 'Rain day. Interior rough MEP continued. Millwork shop confirmed cabinetry release date.', issues: 'Millwork shop flagged a possible 1-week release slip; GC pulled the drywall start forward to protect the finish sequence.',
          crew: [{ trade: 'Electrical', company: 'Meridian Electric', head: 5, hrs: 7 }, { trade: 'Plumbing', company: 'Cascade Plumbing', head: 3, hrs: 7 }],
          progress: [{ taskId: 't-elec-rough', pct: 36 }, { taskId: 't-plumb-rough', pct: 42 }],
          materials: [],
          homeowner: 'Wet day — crews stayed inside on the rough wiring and plumbing. One heads-up: the cabinet shop mentioned a possible one-week slip on delivery, so we\'ve adjusted the schedule ahead of time to keep everything on track. No impact to your move-in target.',
        },
        {
          agoDays: 24, temp: '58°F', conditions: 'PartlyCloudy', work: 'Roof dry-in inspection passed. Waterproofing crew detailed the deck-over-garage assembly.', issues: '',
          crew: [{ trade: 'Roofing', company: 'Ridgeline Roofing', head: 5, hrs: 8 }, { trade: 'Waterproofing', company: 'Sealtec', head: 4, hrs: 8 }],
          progress: [{ taskId: 't-roof', pct: 72 }],
          materials: ['Deck membrane — rolls'],
          homeowner: 'The roof passed its inspection and the waterproofing over the garage deck is being detailed carefully — that\'s the kind of behind-the-walls work that protects the house for decades.',
        },
        {
          agoDays: 27, temp: '61°F', conditions: 'Clear', work: 'Steel topped out and signed off. Framing began on the main level; crane demobilized.', issues: '',
          crew: [{ trade: 'Steel', company: 'Ironline Structural', head: 7, hrs: 9 }, { trade: 'Carpentry', company: 'Anderson Framing', head: 8, hrs: 9 }],
          progress: [{ taskId: 't-steel', pct: 100 }, { taskId: 't-framing', pct: 55 }],
          materials: ['Framing lumber — multiple loads'],
          homeowner: 'The steel is fully up and inspected — that was the big long-lead item, and despite an 8-day delay at the mill we recovered the time by re-sequencing. Framing is now moving fast on the main level.',
        },
      ];
      dfrSeeds.forEach((d, i) => {
        const date = isoDaysAgo(d.agoDays);
        const workProgress: DFRWorkProgress[] = d.progress.map((p) => {
          const task = scheduleTasks.find((t) => t.id === p.taskId);
          return { taskId: p.taskId, taskName: task?.title ?? '', phase: task?.phase ?? '', pct: p.pct };
        });
        addDailyReport({
          id: generateUUID(),
          projectId,
          date,
          weather: { temperature: d.temp, conditions: d.conditions, wind: '5-10 mph', isManual: false },
          manpower: d.crew.map((c) => ({ id: generateUUID(), trade: c.trade, company: c.company, headcount: c.head, hoursWorked: c.hrs })),
          workPerformed: d.work,
          workProgress,
          materialsDelivered: d.materials,
          issuesAndDelays: d.issues,
          incident: undefined,
          photos: [],
          status: i < 3 ? 'sent' : 'draft',
          homeownerSummary: d.homeowner,
          homeownerSummaryGeneratedAt: date,
          homeownerSummaryPublished: i === 0,
          createdAt: date,
          updatedAt: date,
        } as DailyFieldReport);
      });

      // ─── 6. Change orders — 7 (mix approved / pending / one rejected) ───
      // Net approved COs adjust the contract coherently. Amounts are on the
      // marked-up (billed) side. One steel-delay CO documents the flagged
      // risk being handled at no schedule cost.
      let runningContract = CONTRACT;
      const coSeeds: {
        number: number; ago: number; desc: string; reason: string; status: ChangeOrder['status'];
        change: number; schedDays: number; items: { desc: string; qty: number; unit: string; price: number; csi?: string }[];
      }[] = [
        { number: 1, ago: 120, desc: 'Upgrade primary-bath slab to book-matched Calacatta', reason: 'Owner selection exceeded stone allowance', status: 'approved', change: 22_400, schedDays: 0, items: [{ desc: 'Book-matched Calacatta slabs & fabrication', qty: 1, unit: 'ls', price: 22_400, csi: '09' }] },
        { number: 2, ago: 96, desc: 'Add subterranean wine-cellar humidity & glass wall', reason: 'Owner scope addition at design walk', status: 'approved', change: 38_600, schedDays: 4, items: [{ desc: 'Wine-cellar cooling & glass enclosure', qty: 1, unit: 'ls', price: 38_600, csi: '06' }] },
        { number: 3, ago: 74, desc: 'Steel fabricator delay — expedite + partial air freight', reason: 'Mill slip on imported members; recover critical path', status: 'approved', change: 16_800, schedDays: 0, items: [{ desc: 'Air-freight premium on 12 members', qty: 1, unit: 'ls', price: 11_200, csi: '05' }, { desc: 'Overtime re-sequence of framing start', qty: 1, unit: 'ls', price: 5_600, csi: '06' }] },
        { number: 4, ago: 52, desc: 'Add 40 kWh battery to solar package', reason: 'Owner requested whole-home backup', status: 'approved', change: 28_400, schedDays: 0, items: [{ desc: 'Battery storage & transfer gear', qty: 1, unit: 'ls', price: 28_400, csi: '26' }] },
        { number: 5, ago: 30, desc: 'Green roof over garage — structural & waterproofing upgrade', reason: 'Owner selection, LEED credit', status: 'approved', change: 31_200, schedDays: 3, items: [{ desc: 'Living green-roof assembly upgrade', qty: 1, unit: 'ls', price: 31_200, csi: '32' }] },
        { number: 6, ago: 12, desc: 'Extend radiant heat to primary terrace', reason: 'Owner requested at site walk', status: 'submitted', change: 14_600, schedDays: 0, items: [{ desc: 'Snowmelt/radiant loop, terrace', qty: 1, unit: 'ls', price: 14_600, csi: '23' }] },
        { number: 7, ago: 8, desc: 'Upgrade motor-court paving to permeable pavers', reason: 'Owner-proposed; GC recommended alternate', status: 'rejected', change: 19_800, schedDays: 2, items: [{ desc: 'Permeable paver upgrade (declined — cost)', qty: 1, unit: 'ls', price: 19_800, csi: '32' }] },
      ];
      for (const co of coSeeds) {
        const original = runningContract;
        const newTotal = co.status === 'approved' ? original + co.change : original;
        addChangeOrder({
          id: generateUUID(),
          projectId,
          number: co.number,
          date: isoDaysAgo(co.ago),
          description: co.desc,
          reason: co.reason,
          status: co.status,
          scheduleImpactDays: co.schedDays,
          scheduleImpactApplied: co.status === 'approved',
          originalContractValue: original,
          changeAmount: co.change,
          newContractTotal: newTotal,
          lineItems: co.items.map((it) => ({
            id: generateUUID(), name: it.desc, description: it.desc, quantity: it.qty,
            unit: it.unit, unitPrice: it.price, total: Math.round(it.qty * it.price),
            isNew: true, csiDivision: it.csi,
          })),
          approvers: [
            { id: generateUUID(), name: 'Priya Whitaker', email: FLAGSHIP_IDENTITY.primaryContact.email, role: 'Owner' as const, required: true, order: 1, status: co.status === 'approved' ? 'approved' : co.status === 'rejected' ? 'rejected' : 'pending' },
          ],
          approvalMode: 'sequential',
          createdAt: isoDaysAgo(co.ago),
          updatedAt: isoNow,
        } as unknown as ChangeOrder);
        if (co.status === 'approved') runningContract = newTotal;
      }

      // ─── 7. RFIs — 8 across states, ball-in-court, linked drawings ──────
      const rfiSeeds: {
        subject: string; priority: 'low' | 'normal' | 'urgent'; status: 'open' | 'answered' | 'closed';
        assignedTo: string; ago: number; requiredDelta: number; drawing?: string; response?: string;
      }[] = [
        { subject: 'Curtain-wall embed plate elevation conflicts with steel beam at GL-4', priority: 'urgent', status: 'open', assignedTo: 'M. Webb (Structural Engineer)', ago: 2, requiredDelta: 2, drawing: 'S-302' },
        { subject: 'Confirm radiant manifold locations vs. cabinetry toe-kicks', priority: 'normal', status: 'open', assignedTo: 'E. Reyes (Architect)', ago: 4, requiredDelta: 3, drawing: 'M-201' },
        { subject: 'Feature-stair guardrail glass — monolithic or laminated?', priority: 'normal', status: 'answered', assignedTo: 'E. Reyes (Architect)', ago: 14, requiredDelta: -8, drawing: 'A-501', response: 'Use laminated low-iron per structural. Proceed.' },
        { subject: 'Wine-cellar slab depression depth for glass channel', priority: 'normal', status: 'answered', assignedTo: 'M. Webb (Structural Engineer)', ago: 20, requiredDelta: -12, drawing: 'A-140', response: 'Depress 2-1/2". Detail issued as SK-14.' },
        { subject: 'Pool shell rebar spacing at negative edge', priority: 'urgent', status: 'answered', assignedTo: 'M. Webb (Structural Engineer)', ago: 26, requiredDelta: -18, drawing: 'S-410', response: 'Confirmed #4 @ 8" o.c. each way. See SK-11.' },
        { subject: 'Kitchen scullery — verify gas vs. induction rough', priority: 'normal', status: 'closed', assignedTo: 'Owner', ago: 34, requiredDelta: -25, response: 'All-electric induction confirmed. No gas rough.' },
        { subject: 'Exterior cladding reveal dimension at window heads', priority: 'low', status: 'closed', assignedTo: 'E. Reyes (Architect)', ago: 40, requiredDelta: -30, drawing: 'A-311', response: '3/4" reveal typical. Approved.' },
        { subject: 'Elevator pit waterproofing detail below water table', priority: 'normal', status: 'closed', assignedTo: 'M. Webb (Structural Engineer)', ago: 48, requiredDelta: -38, drawing: 'A-142', response: 'Bentonite waterstop + sump. Detail SK-06.' },
      ];
      rfiSeeds.forEach((r) => {
        addRFI({
          projectId,
          subject: r.subject,
          question: `${r.subject} — please advise so we can proceed without impacting the critical path.`,
          priority: r.priority,
          status: r.status,
          ballInCourt: r.status === 'open' ? 'architect' : r.status === 'answered' ? 'gc' : 'closed',
          assignedTo: r.assignedTo,
          dateSubmitted: isoDaysAgo(r.ago),
          dateRequired: isoDaysAgo(r.requiredDelta),
          dateResponded: r.status !== 'open' ? isoDaysAgo(r.ago - 3) : undefined,
          response: r.response,
          submittedBy: 'Summit Ridge Builders',
          linkedDrawing: r.drawing,
          attachments: [],
        });
      });

      // ─── 8. Submittals — 8 across statuses, some with review cycles ─────
      const submittalSeeds: {
        title: string; spec: string; by: string; ago: number; reqDelta: number;
        status: 'pending' | 'in_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected';
        cycles?: { n: number; sentAgo: number; retAgo?: number; reviewer: string; status: 'in_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit'; comments?: string }[];
      }[] = [
        { title: 'Structural steel shop drawings', spec: '05 12 00', by: 'Ironline Structural', ago: 150, reqDelta: -136, status: 'approved_as_noted', cycles: [
          { n: 1, sentAgo: 150, retAgo: 142, reviewer: 'SEOR — Watershed Engineering', status: 'revise_resubmit', comments: 'Revise moment connection at GL-4; confirm embed.' },
          { n: 2, sentAgo: 140, retAgo: 132, reviewer: 'SEOR — Watershed Engineering', status: 'approved_as_noted', comments: 'Approved as noted. Field-verify embed depth.' },
        ] },
        { title: 'Structural glass curtain-wall system', spec: '08 44 00', by: 'Bayview Glass Systems', ago: 96, reqDelta: -60, status: 'approved', cycles: [
          { n: 1, sentAgo: 96, retAgo: 82, reviewer: 'Architect — Studio Meridian', status: 'approved', comments: 'Approved. Release for fabrication.' },
        ] },
        { title: 'Heat-pump HVAC & ERV equipment', spec: '23 81 00', by: 'Summit Mechanical', ago: 74, reqDelta: -50, status: 'approved', cycles: [
          { n: 1, sentAgo: 74, retAgo: 64, reviewer: 'MEP Engineer — Flux', status: 'approved' },
        ] },
        { title: 'Feature staircase fabrication drawings', spec: '05 51 00', by: 'Ironline Structural', ago: 40, reqDelta: -26, status: 'approved_as_noted', cycles: [
          { n: 1, sentAgo: 40, retAgo: 30, reviewer: 'Architect — Studio Meridian', status: 'approved_as_noted', comments: 'Approved as noted — refine handrail return.' },
        ] },
        { title: 'Architectural millwork & cabinetry', spec: '06 40 00', by: 'Peninsula Fine Woodworking', ago: 18, reqDelta: -2, status: 'in_review', cycles: [
          { n: 1, sentAgo: 18, reviewer: 'Architect — Studio Meridian', status: 'in_review' },
        ] },
        { title: 'Solar PV + battery storage', spec: '26 31 00', by: 'Sunhill Energy', ago: 12, reqDelta: 6, status: 'in_review', cycles: [
          { n: 1, sentAgo: 12, reviewer: 'MEP Engineer — Flux', status: 'in_review' },
        ] },
        { title: 'Stone slab selection — countertops', spec: '12 36 00', by: 'Bay Area Stoneworks', ago: 9, reqDelta: 12, status: 'pending', cycles: [] },
        { title: 'Landscape planting & irrigation', spec: '32 90 00', by: 'Terra Landscape', ago: 5, reqDelta: 20, status: 'pending', cycles: [] },
      ];
      submittalSeeds.forEach((s) => {
        addSubmittal({
          projectId,
          title: s.title,
          specSection: s.spec,
          submittedBy: s.by,
          submittedDate: dateDaysAgo(s.ago),
          requiredDate: dateDaysAgo(s.reqDelta),
          currentStatus: s.status,
          attachments: [],
          reviewCycles: (s.cycles ?? []).map((c) => ({
            cycleNumber: c.n,
            sentDate: dateDaysAgo(c.sentAgo),
            returnDate: c.retAgo != null ? dateDaysAgo(c.retAgo) : undefined,
            reviewer: c.reviewer,
            status: c.status,
            comments: c.comments,
          })),
        });
      });

      // ─── 9. Punch list — 16 items across trades / statuses / priorities ─
      const punchSeeds: { desc: string; loc: string; priority: 'low' | 'medium' | 'high'; status: PunchItem['status']; sub: string }[] = [
        { desc: 'Curtain-wall gasket gap at west mullion — reseat', loc: 'Great Room — west wall', priority: 'high', status: 'open', sub: 'Bayview Glass Systems' },
        { desc: 'Radiant manifold label mismatch vs. zone map', loc: 'Mechanical Room', priority: 'medium', status: 'open', sub: 'Summit Mechanical' },
        { desc: 'Missing blocking for towel bar, primary bath', loc: 'Primary Bath', priority: 'low', status: 'open', sub: 'Anderson Framing' },
        { desc: 'Feature-stair weld grind & prime touch-up', loc: 'Great Room — stair', priority: 'medium', status: 'in_progress', sub: 'Ironline Structural' },
        { desc: 'Electrical home-run mislabeled at Panel B', loc: 'Garage — electrical', priority: 'medium', status: 'in_progress', sub: 'Meridian Electric' },
        { desc: 'Roof edge-metal hem loose at NE corner', loc: 'Main Roof — NE', priority: 'high', status: 'in_progress', sub: 'Ridgeline Roofing' },
        { desc: 'Window flashing lap reversed, guest-house south', loc: 'Guest House — south', priority: 'high', status: 'ready_for_review', sub: 'Bayview Glass Systems' },
        { desc: 'Fire-sprinkler head spacing verify vs. plan, cellar', loc: 'Wine Cellar', priority: 'medium', status: 'ready_for_review', sub: 'Guardian Fire Protection' },
        { desc: 'Waterproofing termination bar loose at deck', loc: 'Garage Deck', priority: 'high', status: 'open', sub: 'Sealtec' },
        { desc: 'Duct hanger spacing exceeds spec in attic run', loc: 'Attic — main', priority: 'low', status: 'in_progress', sub: 'Summit Mechanical' },
        { desc: 'Concrete honeycomb patch at board-formed wall', loc: 'Entry — board-formed', priority: 'medium', status: 'closed', sub: 'Granite Concrete' },
        { desc: 'Temporary stair handrail not to height', loc: 'Site — temp stair', priority: 'high', status: 'closed', sub: 'Summit Ridge Builders' },
        { desc: 'Low-voltage box crooked in media room', loc: 'Media Room', priority: 'low', status: 'closed', sub: 'Loop Smart Homes' },
        { desc: 'Elevator rail plumb tolerance re-shim', loc: 'Elevator Shaft', priority: 'medium', status: 'ready_for_review', sub: 'Peninsula Elevator' },
        { desc: 'Cladding fastener pattern off at north reveal', loc: 'North Elevation', priority: 'low', status: 'open', sub: 'Facade Works' },
        { desc: 'Plumbing cleanout access blocked by framing', loc: 'Lower Level — mech', priority: 'medium', status: 'in_progress', sub: 'Cascade Plumbing' },
      ];
      punchSeeds.forEach((p) => {
        addPunchItem({
          id: generateUUID(),
          projectId,
          description: p.desc,
          location: p.loc,
          assignedSub: p.sub,
          dueDate: dateDaysAgo(-14),
          priority: p.priority,
          status: p.status,
          closedAt: p.status === 'closed' ? isoDaysAgo(3) : undefined,
          createdAt: isoDaysAgo(Math.floor(Math.random() * 20) + 4),
          updatedAt: isoNow,
        } as unknown as PunchItem);
      });

      // ─── 10. Photos — 12 with tags/locations; two with markup ──────────
      const photoSeeds: { loc: string; tag: string; ago: number; markup?: boolean }[] = [
        { loc: 'Hillside cut & shoring', tag: 'progress', ago: 150 },
        { loc: 'Caisson drilling', tag: 'progress', ago: 130 },
        { loc: 'Mat slab pour', tag: 'progress', ago: 110 },
        { loc: 'Board-formed entry wall', tag: 'progress', ago: 95 },
        { loc: 'Steel erection — great room', tag: 'progress', ago: 78, markup: true },
        { loc: 'Framing — main level', tag: 'progress', ago: 55 },
        { loc: 'Feature staircase steel', tag: 'progress', ago: 40 },
        { loc: 'Standing-seam roof', tag: 'progress', ago: 28 },
        { loc: 'Curtain-wall install', tag: 'progress', ago: 9, markup: true },
        { loc: 'Primary-wing rough MEP', tag: 'progress', ago: 14 },
        { loc: 'Mechanical room equipment', tag: 'progress', ago: 3 },
        { loc: 'West elevation glazing', tag: 'progress', ago: 1 },
      ];
      const sampleMarkup: PhotoMarkup[] = [
        { id: generateUUID(), type: 'arrow', color: 'red', points: [{ x: 0.2, y: 0.4 }, { x: 0.44, y: 0.56 }] },
        { id: generateUUID(), type: 'text', color: 'yellow', points: [{ x: 0.2, y: 0.32 }], text: 'Verify embed' },
      ];
      photoSeeds.forEach((p, i) => {
        addProjectPhoto({
          id: generateUUID(),
          projectId,
          uri: `https://picsum.photos/seed/overlook-${i}/960/640`,
          timestamp: isoDaysAgo(p.ago),
          location: p.loc,
          tag: p.tag,
          markup: p.markup ? sampleMarkup : undefined,
          latitude: 37.3688 + (Math.random() - 0.5) * 0.002,
          longitude: -122.1411 + (Math.random() - 0.5) * 0.002,
          createdAt: isoDaysAgo(p.ago),
        } as ProjectPhoto);
      });

      // ─── 11. Subcontractors + contacts (referenced by COIs/commitments) ─
      const subSteelId = generateUUID();
      const subMechId = generateUUID();
      const subGlassId = generateUUID();
      const subElecId = generateUUID();
      const subDefs: { id: string; company: string; contact: string; trade: Subcontractor['trade']; phone: string; email: string }[] = [
        { id: subSteelId, company: 'Ironline Structural', contact: 'Ray Tucker', trade: 'General', phone: '(650) 555-0188', email: 'ray@ironline.example.com' },
        { id: subMechId, company: 'Summit Mechanical', contact: 'Priya Nadeem', trade: 'HVAC', phone: '(650) 555-0211', email: 'priya@summitmech.example.com' },
        { id: subGlassId, company: 'Bayview Glass Systems', contact: 'Owen Park', trade: 'Other', phone: '(650) 555-0233', email: 'owen@bayviewglass.example.com' },
        { id: subElecId, company: 'Meridian Electric', contact: 'Dana Cole', trade: 'Electrical', phone: '(650) 555-0247', email: 'dana@meridianelec.example.com' },
      ];
      for (const s of subDefs) {
        addSubcontractor({
          id: s.id,
          companyName: s.company,
          contactName: s.contact,
          phone: s.phone,
          email: s.email,
          address: 'San Jose, CA',
          trade: s.trade,
          licenseNumber: `CA-${Math.floor(100000 + Math.random() * 899999)}`,
          licenseState: 'CA',
          licenseExpiry: dateDaysAgo(-320),
          coiExpiry: dateDaysAgo(-210),
          w9OnFile: true,
          bidHistory: [],
          assignedProjects: [projectId],
          notes: '',
          createdAt: isoDaysAgo(START + 10),
          updatedAt: isoNow,
        });
      }
      const contactDefs: { first: string; last: string; company: string; role: Contact['role']; email: string; phone: string }[] = [
        { first: 'Elena', last: 'Reyes', company: 'Studio Meridian Architecture', role: 'Architect', email: 'elena@studiomeridian.example.com', phone: '(650) 555-0102' },
        { first: 'Marcus', last: 'Webb', company: 'Watershed Engineering', role: 'Engineer', email: 'mwebb@watershed.example.com', phone: '(650) 555-0133' },
        { first: 'Priya', last: 'Whitaker', company: 'Owner', role: 'Client', email: FLAGSHIP_IDENTITY.primaryContact.email, phone: FLAGSHIP_IDENTITY.primaryContact.phone },
        { first: 'Tom', last: 'Alvarez', company: 'Los Altos Hills Building Dept.', role: 'Inspector', email: 'inspections@lah.example.gov', phone: '(650) 555-0170' },
      ];
      for (const c of contactDefs) {
        addContact({
          id: generateUUID(),
          firstName: c.first,
          lastName: c.last,
          companyName: c.company,
          role: c.role,
          email: c.email,
          phone: c.phone,
          address: 'Los Altos Hills, CA',
          notes: '',
          linkedProjectIds: [projectId],
          createdAt: isoDaysAgo(START + 12),
          updatedAt: isoNow,
        });
      }

      // ─── 12. Commitments — 4 signed subcontracts for job costing ────────
      const commitDefs: { number: string; vendor: string; subId: string; desc: string; amount: number; phase: string; csi: string; linked: string[] }[] = [
        { number: 'SC-01', vendor: 'Ironline Structural', subId: subSteelId, desc: 'Structural steel & feature stair package', amount: 712_000, phase: 'Structure', csi: '05', linked: ['li-steel', 'li-steel-misc', 'li-mono-stair'] },
        { number: 'SC-02', vendor: 'Summit Mechanical', subId: subMechId, desc: 'HVAC, ERV & radiant package', amount: 388_000, phase: 'MEP', csi: '23', linked: ['li-hvac', 'li-radiant'] },
        { number: 'SC-03', vendor: 'Bayview Glass Systems', subId: subGlassId, desc: 'Curtain wall, windows & lift-slide doors', amount: 462_000, phase: 'Envelope', csi: '08', linked: ['li-curtainwall', 'li-windows'] },
        { number: 'SC-04', vendor: 'Meridian Electric', subId: subElecId, desc: 'Electrical, solar, battery & smart-home', amount: 496_000, phase: 'MEP', csi: '26', linked: ['li-electrical', 'li-solar', 'li-smart-home', 'li-generator'] },
      ];
      for (const c of commitDefs) {
        addCommitment({
          id: generateUUID(),
          projectId,
          number: c.number,
          type: 'subcontract',
          subcontractorId: c.subId,
          vendorName: c.vendor,
          description: c.desc,
          amount: c.amount,
          signedDate: dateDaysAgo(START - 6),
          phase: c.phase,
          csiDivision: c.csi,
          linkedEstimateItems: c.linked,
          status: 'active',
          notes: '',
          createdAt: isoDaysAgo(START - 6),
          updatedAt: isoNow,
        });
      }

      // ─── 13. Equipment — 3 (rented crane, owned skid steer, rented lift) ─
      const equipDefs: { name: string; type: Equipment['type']; category: Equipment['category']; make: string; model: string; rate: number; status: Equipment['status'] }[] = [
        { name: 'Tower crane', type: 'rented', category: 'lifting', make: 'Potain', model: 'MDT 389', rate: 1_650, status: 'available' },
        { name: 'Skid steer', type: 'owned', category: 'excavation', make: 'Bobcat', model: 'S770', rate: 340, status: 'in_use' },
        { name: 'Telescopic boom lift', type: 'rented', category: 'aerial', make: 'JLG', model: '1200SJP', rate: 520, status: 'in_use' },
      ];
      for (const e of equipDefs) {
        addEquipment({
          name: e.name,
          type: e.type,
          category: e.category,
          make: e.make,
          model: e.model,
          year: 2024,
          dailyRate: e.rate,
          currentProjectId: projectId,
          maintenanceSchedule: [],
          utilizationLog: [
            { id: generateUUID(), equipmentId: 'pending', projectId, date: dateDaysAgo(9), hoursUsed: 8, operatorName: 'Site crew' },
            { id: generateUUID(), equipmentId: 'pending', projectId, date: dateDaysAgo(4), hoursUsed: 6, operatorName: 'Site crew' },
          ],
          status: e.status,
        });
      }

      // ─── 14. COIs — 2 tied to seeded subs ───────────────────────────────
      for (const subId of [subSteelId, subGlassId]) {
        addCOI({
          id: generateUUID(),
          subcontractorId: subId,
          projectId,
          fileUri: 'https://picsum.photos/seed/overlook-coi/800/1000',
          uploadedAt: isoDaysAgo(START - 8),
          validation: { validatedAt: isoDaysAgo(START - 8), overallStatus: 'pass', issues: [], confidence: 97 },
          coverages: [
            { type: 'general_liability', carrierName: 'Travelers', eachOccurrence: 2_000_000, generalAggregate: 4_000_000, effectiveDate: dateDaysAgo(210), expiresAt: dateDaysAgo(-155) },
            { type: 'workers_comp', carrierName: 'State Fund CA', eachOccurrence: 1_000_000, effectiveDate: dateDaysAgo(210), expiresAt: dateDaysAgo(-155) },
          ],
          notes: 'On file; verified against carrier. Additional-insured endorsement present.',
        });
      }

      // ─── 15. Permits — 5, mixed statuses ────────────────────────────────
      const permitSeeds: { type: Permit['type']; status: Permit['status']; fee: number; appliedAgo: number; approvedAgo?: number; inspectionAgo?: number; phase: string; notes: string }[] = [
        { type: 'building', status: 'approved', fee: 38_400, appliedAgo: START + 24, approvedAgo: START + 2, phase: 'Foundation', notes: 'Master building permit — issued.' },
        { type: 'grading', status: 'inspection_passed', fee: 12_800, appliedAgo: START + 20, approvedAgo: START, inspectionAgo: 128, phase: 'Sitework', notes: 'Hillside grading permit; rough grade passed.' },
        { type: 'electrical', status: 'inspection_scheduled', fee: 6_400, appliedAgo: START - 20, approvedAgo: START - 30, inspectionAgo: -3, phase: 'Rough-in', notes: 'Rough electrical inspection scheduled.' },
        { type: 'plumbing', status: 'inspection_scheduled', fee: 5_200, appliedAgo: START - 22, approvedAgo: START - 32, inspectionAgo: -4, phase: 'Rough-in', notes: 'Top-out inspection scheduled.' },
        { type: 'mechanical', status: 'under_review', fee: 4_800, appliedAgo: 14, phase: 'Rough-in', notes: 'HVAC permit in plan review.' },
      ];
      for (const p of permitSeeds) {
        addPermit({
          projectId,
          projectName: project.name,
          type: p.type,
          permitNumber: p.status === 'under_review' ? undefined : `${p.type.slice(0, 3).toUpperCase()}-2025-${Math.floor(1000 + Math.random() * 8999)}`,
          jurisdiction: 'Town of Los Altos Hills',
          status: p.status,
          appliedDate: dateDaysAgo(p.appliedAgo),
          approvedDate: p.approvedAgo != null ? dateDaysAgo(p.approvedAgo) : undefined,
          inspectionDate: p.inspectionAgo != null ? dateDaysAgo(p.inspectionAgo) : undefined,
          inspectionNotes: p.inspectionAgo != null ? 'Inspector on site; see report.' : undefined,
          fee: p.fee,
          phase: p.phase,
          notes: p.notes,
        });
      }

      // ─── 16. Permit & inspection roadmap ────────────────────────────────
      savePermitRoadmap({
        id: generateUUID(),
        projectId,
        generatedAt: isoDaysAgo(START + 18),
        scopeHash: `flagship-${projectId.slice(0, 8)}`,
        permits: [
          { id: generateUUID(), type: 'building', title: 'Master building permit', description: 'Full new-construction building permit.', whoPulls: 'gc', leadTimeDays: 45, status: 'approved' },
          { id: generateUUID(), type: 'electrical', title: 'Electrical permit', description: 'Service, rough + final electrical + solar interconnection.', whoPulls: 'sub', leadTimeDays: 10, status: 'approved' },
          { id: generateUUID(), type: 'plumbing', title: 'Plumbing permit', description: 'Water, sewer, gas rough + top-out.', whoPulls: 'sub', leadTimeDays: 10, status: 'approved' },
          { id: generateUUID(), type: 'mechanical', title: 'Mechanical / HVAC permit', description: 'Heat-pump HVAC + ERV + radiant.', whoPulls: 'sub', leadTimeDays: 10, status: 'applied' },
        ],
        inspections: [
          { id: generateUUID(), type: 'foundation', title: 'Foundation / pre-pour inspection', description: 'Rebar + forms before concrete.', gatesTaskHint: 'Foundation walls & mat slab', leadTimeDays: 2, status: 'passed' },
          { id: generateUUID(), type: 'framing', title: 'Framing inspection', description: 'Structure + shear before cover.', gatesTaskHint: 'Rough carpentry & heavy timber framing', leadTimeDays: 2, status: 'scheduled' },
          { id: generateUUID(), type: 'rough_mep', title: 'Rough MEP inspection', description: 'Electrical, plumbing, mechanical rough before insulation.', gatesTaskHint: 'Rough MEP inspection', leadTimeDays: 2, status: 'pending' },
          { id: generateUUID(), type: 'final', title: 'Final / CO inspection', description: 'Certificate of Occupancy walk.', gatesTaskHint: 'Final inspection & Certificate of Occupancy', leadTimeDays: 3, status: 'pending' },
        ],
      });

      // ─── 17. Plan sheet + code review + living-floor-plan zones ──────────
      const planSheet = addPlanSheet({
        projectId,
        name: 'A-201 Main Level Floor Plan',
        sheetNumber: 'A-201',
        imageUri: 'https://picsum.photos/seed/overlook-plan-a201/1600/1100',
        pageNumber: 1,
        width: 1600,
        height: 1100,
      });
      const findings: CodeFinding[] = [
        { id: generateUUID(), category: 'egress', codeRef: 'CRC R310.2.1', requirement: 'Emergency escape opening min 5.7 sf, sill ≤ 44".', observed: 'Guest bedroom window sill scales to 46".', severity: 'high', confidence: 'high', status: 'open' },
        { id: generateUUID(), category: 'stairs', codeRef: 'CRC R311.7.5', requirement: 'Riser ≤ 7-3/4", tread ≥ 10".', observed: 'Feature stair riser noted 7-7/8" on section.', severity: 'med', confidence: 'med', status: 'open' },
        { id: generateUUID(), category: 'guards', codeRef: 'CRC R312.1.2', requirement: 'Guard height ≥ 42" at exterior deck > 30" drop.', observed: 'Terrace guard scales 40" on elevation.', severity: 'med', confidence: 'low', status: 'resolved' },
        { id: generateUUID(), category: 'fire', codeRef: 'CRC R313.2', requirement: 'Automatic sprinklers required (new dwelling).', observed: 'Confirmed full NFPA 13D system on drawings.', severity: 'low', confidence: 'high', status: 'dismissed' },
        { id: generateUUID(), category: 'ada', codeRef: 'CBC 11B', requirement: 'ADU accessible route + clearances.', observed: 'Guest-house entry step needs ramp or grade transition.', severity: 'med', confidence: 'med', status: 'open' },
      ];
      savePlanReview({ id: generateUUID(), projectId, planSheetId: planSheet.id, reviewedAt: isoDaysAgo(START - 10), findings });
      addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.06, y: 0.08, w: 0.40, h: 0.36, label: 'Chef\'s Kitchen & Scullery', linkedTaskIds: ['t-millwork', 't-plumb-rough'], color: Colors.tradeColors.general });
      addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.50, y: 0.08, w: 0.44, h: 0.44, label: 'Great Room', linkedTaskIds: ['t-curtainwall', 't-flooring'], color: Colors.tradeColors.electrical });
      addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.08, y: 0.52, w: 0.40, h: 0.40, label: 'Primary Suite', linkedTaskIds: ['t-drywall', 't-tile'], color: Colors.tradeColors.landscaping });
      addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.54, y: 0.56, w: 0.38, h: 0.36, label: 'Wine Cellar', linkedTaskIds: ['t-wine-cellar'], color: Colors.tradeColors.steel });

      // ─── 18. Warranties — 3, one with a resolved claim ──────────────────
      const roofWarranty = addWarranty({
        projectId,
        projectName: project.name,
        title: 'Standing-seam metal roof — 40yr',
        category: 'roofing',
        description: 'Manufacturer + workmanship warranty on the standing-seam assembly.',
        provider: 'Ridgeline Roofing / Drexel Metals',
        startDate: dateDaysAgo(24),
        durationMonths: 480,
        endDate: dateDaysAgo(24 - 480 * 30),
        coverageDetails: 'Material 40yr, finish 30yr, workmanship 10yr.',
      });
      addWarranty({
        projectId,
        projectName: project.name,
        title: 'Heat-pump HVAC — 10yr parts',
        category: 'hvac',
        description: 'All-electric variable-speed heat-pump system + ERV.',
        provider: 'Mitsubishi / Summit Mechanical',
        startDate: dateDaysAgo(6),
        durationMonths: 120,
        endDate: dateDaysAgo(6 - 120 * 30),
        coverageDetails: 'Compressor + parts 10yr with registration.',
      });
      addWarranty({
        projectId,
        projectName: project.name,
        title: 'Solar + battery — 25yr production / 10yr battery',
        category: 'electrical',
        description: '22 kW array + 40 kWh battery storage.',
        provider: 'Sunhill Energy / Tesla',
        startDate: dateDaysAgo(2),
        durationMonths: 300,
        endDate: dateDaysAgo(2 - 300 * 30),
        coverageDetails: 'Panels 25yr production, battery 10yr, inverter 12yr.',
      });
      if (roofWarranty?.id) {
        addWarrantyClaim(roofWarranty.id, {
          date: dateDaysAgo(10),
          description: 'Minor drip at south valley flashing after first heavy rain.',
          resolution: 'Re-sealed valley flashing; hose-tested. No interior damage.',
          resolvedAt: dateDaysAgo(8),
          cost: 0,
        });
      }

      // ─── 19. AIA G702/G703 pay application ──────────────────────────────
      // Full Schedule of Values by CSI division. Scheduled values sum to the
      // contract; % complete matches the schedule so the cover total lands at
      // ~55% earned — the same story the invoices + budget tell.
      const sovDefs: { itemNo: string; description: string; scheduledValue: number; pctComplete: number }[] = [
        { itemNo: '01', description: 'General requirements', scheduledValue: 700_000, pctComplete: 55 },
        { itemNo: '02', description: 'Demolition & abatement', scheduledValue: 44_000, pctComplete: 100 },
        { itemNo: '31', description: 'Earthwork, shoring & caissons', scheduledValue: 923_000, pctComplete: 100 },
        { itemNo: '33', description: 'Site utilities', scheduledValue: 111_000, pctComplete: 100 },
        { itemNo: '03', description: 'Concrete & foundation', scheduledValue: 856_000, pctComplete: 100 },
        { itemNo: '05', description: 'Structural steel & stair', scheduledValue: 743_000, pctComplete: 100 },
        { itemNo: '06', description: 'Carpentry, millwork & cabinetry', scheduledValue: 852_000, pctComplete: 42 },
        { itemNo: '07', description: 'Thermal, roofing & cladding', scheduledValue: 561_000, pctComplete: 62 },
        { itemNo: '08', description: 'Glazing, curtain wall & openings', scheduledValue: 631_000, pctComplete: 32 },
        { itemNo: '09', description: 'Finishes (drywall, tile, flooring, paint)', scheduledValue: 980_000, pctComplete: 5 },
        { itemNo: '11', description: 'Appliances & specialties', scheduledValue: 200_000, pctComplete: 0 },
        { itemNo: '13', description: 'Pool & spa', scheduledValue: 311_000, pctComplete: 0 },
        { itemNo: '14', description: 'Elevator', scheduledValue: 90_000, pctComplete: 40 },
        { itemNo: '21', description: 'Fire protection', scheduledValue: 79_000, pctComplete: 30 },
        { itemNo: '22', description: 'Plumbing', scheduledValue: 348_000, pctComplete: 52 },
        { itemNo: '23', description: 'HVAC & radiant', scheduledValue: 346_000, pctComplete: 40 },
        { itemNo: '26', description: 'Electrical, solar & battery', scheduledValue: 555_000, pctComplete: 45 },
        { itemNo: '27', description: 'Smart-home & AV', scheduledValue: 165_000, pctComplete: 15 },
        { itemNo: '32', description: 'Landscape & hardscape', scheduledValue: 646_000, pctComplete: 8 },
      ];
      const retPct = 10;
      const lines = sovDefs.map((s) => {
        const completed = Math.round(s.scheduledValue * (s.pctComplete / 100));
        const thisPeriod = Math.round(completed * 0.18);
        return {
          id: generateUUID(),
          itemNo: s.itemNo,
          description: s.description,
          scheduledValue: s.scheduledValue,
          fromPreviousApp: completed - thisPeriod,
          thisPeriod,
          materialsPresentlyStored: 0,
          retainagePercent: retPct,
        };
      });
      const totalScheduledValue = lines.reduce((sum, l) => sum + l.scheduledValue, 0);
      const totalCompletedAndStored = lines.reduce((sum, l) => sum + l.fromPreviousApp + l.thisPeriod + l.materialsPresentlyStored, 0);
      const totalRetainage = Math.round(totalCompletedAndStored * (retPct / 100));
      const totalEarnedLessRetainage = totalCompletedAndStored - totalRetainage;
      const lessPreviousCertificates = Math.round(totalEarnedLessRetainage * 0.82);
      addAIAPayApp({
        id: generateUUID(),
        projectId,
        applicationNumber: 8,
        applicationDate: dateDaysAgo(6),
        periodTo: dateDaysAgo(6),
        contractDate: dateDaysAgo(START + 30),
        ownerName: FLAGSHIP_IDENTITY.primaryContact.name,
        contractorName: 'Summit Ridge Builders',
        architectName: 'Studio Meridian Architecture',
        projectName: project.name,
        projectLocation: project.location,
        contractForDescription: 'New custom hillside estate — ground-up construction (GMP)',
        originalContractSum: CONTRACT,
        netChangeByCO: 137_400,
        contractSumToDate: CONTRACT + 137_400,
        retainagePercent: retPct,
        lessPreviousCertificates,
        lines,
        notes: 'Application No. 8 — period ending this week. 10% retainage held.',
        totals: {
          totalScheduledValue,
          totalCompletedAndStored,
          totalRetainage,
          totalEarnedLessRetainage,
          currentPaymentDue: totalEarnedLessRetainage - lessPreviousCertificates,
          balanceToFinish: totalScheduledValue - totalCompletedAndStored,
          percentComplete: Math.round((totalCompletedAndStored / totalScheduledValue) * 100),
        },
        savedAt: isoNow,
      });

      // ─── 20. OAC weekly meeting ─────────────────────────────────────────
      addOACMeeting({
        id: generateUUID(),
        projectId,
        number: 26,
        scheduledAt: isoDaysAgo(4),
        durationMinutes: 60,
        location: 'Site trailer',
        attendees: [
          { id: generateUUID(), name: 'Priya Whitaker', role: 'owner', company: 'Owner', attended: true },
          { id: generateUUID(), name: 'Elena Reyes', role: 'architect', company: 'Studio Meridian', attended: true },
          { id: generateUUID(), name: 'Marcus Webb', role: 'engineer', company: 'Watershed Engineering', attended: false },
          { id: generateUUID(), name: authorName, role: 'gc', company: 'Summit Ridge Builders', attended: true },
        ],
        agenda: [
          { id: generateUUID(), section: 'safety', title: 'Zero recordables this period; fall-protection audit passed', status: 'done' },
          { id: generateUUID(), section: 'schedule', title: 'Curtain wall on track; framing 92% complete', status: 'info' },
          { id: generateUUID(), section: 'rfis', title: 'RFI #1 (embed conflict at GL-4) — overdue, expedite', status: 'urgent', referenceType: 'rfi' },
          { id: generateUUID(), section: 'change_orders', title: 'CO #6 (terrace radiant) pending owner approval', status: 'warn', referenceType: 'change_order' },
          { id: generateUUID(), section: 'budget', title: 'Earned ~52% of contract; billed 42% (slightly underbilled); 10% retention held', status: 'info' },
        ],
        actionItems: [
          { id: generateUUID(), description: 'Structural to respond to RFI #1 embed conflict', ballInCourt: 'Watershed Engineering', dueBy: dateDaysAgo(-2), status: 'open', createdAt: isoDaysAgo(4) },
          { id: generateUUID(), description: 'Owner to approve CO #6 terrace radiant', ballInCourt: 'Owner', dueBy: dateDaysAgo(-3), status: 'open', createdAt: isoDaysAgo(4) },
        ],
        minutes: 'Team reviewed safety (clean), schedule (on track), and open RFIs/COs. Curtain-wall sequence confirmed. Action items assigned as noted.',
        status: 'distributed',
        distributedAt: isoDaysAgo(4),
        createdAt: isoDaysAgo(5),
        updatedAt: isoNow,
      });

      // ─── 21. Safety records (JHA, toolbox, incident, hazards, inspection, certs)
      const jha: JobHazardAnalysis = {
        id: generateUUID(),
        projectId,
        title: 'Curtain-wall glazing at height',
        trade: 'Glazing',
        taskDescription: 'Setting structural glass curtain-wall units on the great-room elevation using boom lift and crane assist.',
        date: dateDaysAgo(2),
        steps: [
          { id: generateUUID(), step: 'Rig & lift glass units', hazards: ['Struck-by falling glass', 'Crane contact'], controls: ['Tag lines', 'Exclusion zone', 'Certified rigger'] },
          { id: generateUUID(), step: 'Work from boom lift', hazards: ['Fall from height', 'Tip-over'], controls: ['100% tie-off', 'Level ground plates', 'Spotter'] },
          { id: generateUUID(), step: 'Set & seal units', hazards: ['Pinch points', 'Silicone exposure'], controls: ['Cut-resistant gloves', 'Ventilation', 'PPE'] },
        ],
        requiredPPE: ['Hard hat', 'Safety glasses', 'Cut-resistant gloves', 'Full-body harness'],
        signOffs: [
          { name: 'Owen Park', role: 'Glazing foreman', signedAt: isoDaysAgo(2) },
          { name: authorName, role: 'Site superintendent', signedAt: isoDaysAgo(2) },
        ],
        aiGenerated: true,
        status: 'active',
        createdBy: authorName,
        createdAt: isoDaysAgo(2),
        updatedAt: isoDaysAgo(2),
      };
      addJha(jha);

      const toolbox: ToolboxTalk = {
        id: generateUUID(),
        projectId,
        topic: 'Fall protection & tie-off at leading edges',
        date: dateDaysAgo(2),
        presenter: authorName,
        notes: 'Reviewed 100% tie-off policy at all leading edges above 6 ft, harness inspection, and anchor-point ratings ahead of curtain-wall and cladding work.',
        attendees: [
          { name: 'Owen Park', signedAt: isoDaysAgo(2) },
          { name: 'Dana Cole', signedAt: isoDaysAgo(2) },
          { name: 'Ray Tucker', signedAt: isoDaysAgo(2) },
        ],
        aiTopicSource: 'weather',
        createdBy: authorName,
        createdAt: isoDaysAgo(2),
        updatedAt: isoDaysAgo(2),
      };
      addToolboxTalk(toolbox);

      const incident: SafetyIncident = {
        id: generateUUID(),
        projectId,
        type: 'near_miss',
        severity: 'low',
        occurredAt: isoDaysAgo(19),
        description: 'A bundle of EMT slid off a partially loaded pipe rack near the mechanical room. No one was in the path. Rack loading procedure re-briefed.',
        location: 'Mechanical Room',
        peopleInvolved: [],
        photoUrls: [],
        correctiveActions: [
          { action: 'Re-brief material rack loading & banding', owner: authorName, dueDate: dateDaysAgo(17), done: true },
        ],
        treatment: 'none',
        daysAway: 0,
        daysRestricted: 0,
        restrictedDuty: false,
        lostConsciousness: false,
        fatality: false,
        oshaRecordable: false,
        status: 'closed',
        reportedBy: authorName,
        createdBy: authorName,
        createdAt: isoDaysAgo(19),
        updatedAt: isoDaysAgo(17),
      };
      addIncident(incident);

      const hazardSeeds: { desc: string; loc: string; sev: 1 | 2 | 3 | 4 | 5; like: 1 | 2 | 3 | 4 | 5; status: Hazard['status']; action: string }[] = [
        { desc: 'Unguarded floor opening at stair void', loc: 'Great Room — stair', sev: 4, like: 3, status: 'mitigated', action: 'Guardrail + cover installed; verified.' },
        { desc: 'Trailing extension cords across walkway', loc: 'Main Level — east', sev: 2, like: 4, status: 'open', action: 'Route overhead / use cord ramps.' },
        { desc: 'Silica dust during concrete grinding', loc: 'Entry — board-formed', sev: 3, like: 3, status: 'mitigated', action: 'Wet-cut + HEPA vac + respirators.' },
      ];
      hazardSeeds.forEach((h) => {
        const hz: Hazard = {
          id: generateUUID(),
          projectId,
          description: h.desc,
          location: h.loc,
          severity: h.sev,
          likelihood: h.like,
          riskScore: h.sev * h.like,
          assignedTo: authorName,
          dueDate: dateDaysAgo(-5),
          correctiveAction: h.action,
          status: h.status,
          createdBy: authorName,
          createdAt: isoDaysAgo(Math.floor(Math.random() * 14) + 3),
          updatedAt: isoNow,
        };
        addHazard(hz);
      });

      const inspItems: InspectionItem[] = [
        { id: generateUUID(), prompt: 'Fall protection in use above 6 ft', result: 'pass' },
        { id: generateUUID(), prompt: 'Ladders & lifts inspected/tagged', result: 'pass' },
        { id: generateUUID(), prompt: 'Housekeeping / egress paths clear', result: 'fail', note: 'Cords across east walkway — hazard logged.' },
        { id: generateUUID(), prompt: 'Fire extinguishers accessible & charged', result: 'pass' },
        { id: generateUUID(), prompt: 'PPE worn by all on site', result: 'pass' },
        { id: generateUUID(), prompt: 'Silica controls in place for grinding', result: 'pass' },
      ];
      const passCount = inspItems.filter((it) => it.result === 'pass').length;
      const scoredCount = inspItems.filter((it) => it.result !== 'na').length;
      const inspection: SafetyInspection = {
        id: generateUUID(),
        projectId,
        title: 'Weekly site safety audit',
        date: dateDaysAgo(2),
        inspector: authorName,
        items: inspItems,
        score: Math.round((passCount / scoredCount) * 100) / 100,
        status: 'complete',
        createdAt: isoDaysAgo(2),
        createdBy: authorName,
        updatedAt: isoDaysAgo(2),
      };
      addInspection(inspection);

      const certSeeds: { holder: string; type: string; issuedAgo: number; expiresAgo: number }[] = [
        { holder: authorName, type: 'OSHA 30', issuedAgo: 400, expiresAgo: -1400 },
        { holder: 'Owen Park', type: 'OSHA 10', issuedAgo: 300, expiresAgo: -1500 },
        { holder: 'Ray Tucker', type: 'Certified Rigger / Signal Person', issuedAgo: 200, expiresAgo: -900 },
        { holder: 'Dana Cole', type: 'First Aid / CPR', issuedAgo: 500, expiresAgo: 40 },
      ];
      certSeeds.forEach((c) => {
        const expiresDate = dateDaysAgo(c.expiresAgo);
        const daysToExpiry = -c.expiresAgo;
        const status: Certification['status'] = daysToExpiry < 0 ? 'expired' : daysToExpiry < 60 ? 'expiring' : 'valid';
        const cert: Certification = {
          id: generateUUID(),
          holderName: c.holder,
          type: c.type,
          issuedDate: dateDaysAgo(c.issuedAgo),
          expiresDate,
          status,
          createdAt: isoDaysAgo(c.issuedAgo),
          createdBy: authorName,
          updatedAt: isoNow,
        };
        addCertification(cert);
      });

      // ─── 22. Client portal thread — 6 messages ──────────────────────────
      const thread: { authorType: PortalMessage['authorType']; authorName: string; body: string; ago: number }[] = [
        { authorType: 'gc', authorName: 'Summit Ridge Builders', body: 'Steel is topped out and framing is 92% done — we\'re right around the halfway mark overall and dead on schedule. New photos are in your gallery, including the great-room glass going up.', ago: 9 },
        { authorType: 'client', authorName: 'Priya Whitaker', body: 'The glass wall looks unbelievable already. James is obsessed with the staircase. Quick one — can we still tweak the wine-cellar glass tint?', ago: 8 },
        { authorType: 'gc', authorName: 'Summit Ridge Builders', body: 'Absolutely — the cellar glass submittal is still open. I\'ll add two tint options to Selections tonight. Both are within the allowance.', ago: 8 },
        { authorType: 'client', authorName: 'James Whitaker', body: 'Perfect. Also saw CO #6 for the terrace radiant — approving that now, we love the idea of a warm terrace in winter.', ago: 6 },
        { authorType: 'gc', authorName: 'Summit Ridge Builders', body: 'Thank you! I\'ll get that scheduled with the mechanical crew. No schedule impact. Rough MEP inspection is next week — big milestone.', ago: 5 },
        { authorType: 'client', authorName: 'Priya Whitaker', body: 'This portal has genuinely made the whole thing feel calm. Being able to see the budget against the cap in real time is everything. Thank you both.', ago: 2 },
      ];
      for (const m of thread) {
        addPortalMessage({
          projectId,
          portalId,
          authorType: m.authorType,
          authorName: m.authorName,
          body: m.body,
          readByGc: m.authorType === 'gc' || m.ago > 3,
          readByClient: m.authorType === 'client' || m.ago > 3,
        });
      }

      // ─── 23. Async wave engines (contract, selections, waivers, binder) ─
      const contractPromise = saveContract({
        projectId,
        version: 1,
        title: 'The Overlook Estate — Construction Agreement (GMP)',
        contractValue: CONTRACT,
        scopeText: FLAGSHIP_IDENTITY.description,
        termsText: `Guaranteed Maximum Price of $${CONTRACT.toLocaleString()} with a ${FLAGSHIP_FEE_PERCENT}% builder's fee on cost, open-book. Savings under the GMP are shared 75/25 (owner/builder). Payment per the milestone schedule below; 10% retention held until substantial completion.`,
        warrantyText: 'Twelve-month workmanship warranty from substantial completion. Manufacturer warranties (roof, HVAC, solar, appliances) pass through to homeowner.',
        startDate: isoDaysAgo(START + 30),
        durationDays: 500,
        paymentSchedule: [
          { id: generateUUID(), label: 'Deposit & mobilization', trigger: 'on_signing', amount: 918_000, percent: 10, status: 'paid', paidAt: isoDaysAgo(START + 28) },
          { id: generateUUID(), label: 'Foundation complete', trigger: 'on_milestone', amount: 1_377_000, percent: 15, status: 'paid', paidAt: isoDaysAgo(96) },
          { id: generateUUID(), label: 'Structure topped out', trigger: 'on_milestone', amount: 1_836_000, percent: 20, status: 'paid', paidAt: isoDaysAgo(24) },
          { id: generateUUID(), label: 'Dry-in + rough MEP complete', trigger: 'on_milestone', amount: 1_836_000, percent: 20, status: 'invoiced', invoicedAt: isoDaysAgo(6) },
          { id: generateUUID(), label: 'Finishes complete', trigger: 'on_milestone', amount: 2_295_000, percent: 25, status: 'pending' },
          { id: generateUUID(), label: 'Final + Certificate of Occupancy', trigger: 'on_final', amount: 918_000, percent: 10, status: 'pending' },
        ],
        allowances: [
          { id: generateUUID(), category: 'Bathroom & Feature Tile', amount: 96_000, description: 'All baths + feature walls' },
          { id: generateUUID(), category: 'Stone Flooring', amount: 124_800, description: 'Main-level stone slab & tile' },
          { id: generateUUID(), category: 'Appliances', amount: 118_000, description: 'Kitchen + scullery package' },
          { id: generateUUID(), category: 'Plumbing Fixtures', amount: 86_000, description: 'Whole house' },
          { id: generateUUID(), category: 'Lighting Fixtures', amount: 88_000, description: 'Architectural, owner-selected' },
        ],
        gcSignature: { name: 'Summit Ridge Builders LLC', role: 'gc', signedAt: isoDaysAgo(START + 29) },
        homeownerSignature: { name: 'James Whitaker', role: 'homeowner', signedAt: isoDaysAgo(START + 28) },
        signedAt: isoDaysAgo(START + 28),
        status: 'signed',
      });

      type SelOpt = { product: string; brand: string; total: number; isChosen: boolean; url?: string; query?: string };
      const selSeeds: { name: string; budget: number; brief: string; options: SelOpt[] }[] = [
        {
          name: 'Bathroom & Feature Tile', budget: 96_000, brief: 'Spa feel, book-matched stone & large-format',
          options: [
            { product: 'Calacatta honed large-format', brand: 'Ann Sacks', total: 88_000, isChosen: true, query: 'calacatta marble large format tile' },
            { product: 'Statuario polished slab', brand: 'Walker Zanger', total: 96_000, isChosen: false, query: 'statuario marble slab bathroom' },
            { product: 'Zellige handmade field', brand: 'Clé Tile', total: 74_000, isChosen: false, query: 'zellige tile handmade' },
          ],
        },
        {
          name: 'Appliances', budget: 118_000, brief: 'Pro kitchen + scullery, integrated, all-electric',
          options: [
            { product: 'Gaggenau 400 series suite', brand: 'Gaggenau', total: 124_000, isChosen: true, query: 'gaggenau 400 series kitchen' }, // OVER allowance → CO CTA
            { product: 'Wolf + Sub-Zero suite', brand: 'Sub-Zero/Wolf', total: 112_000, isChosen: false, query: 'wolf sub-zero kitchen suite' },
            { product: 'Thermador Freedom suite', brand: 'Thermador', total: 96_000, isChosen: false, query: 'thermador freedom kitchen' },
          ],
        },
        {
          name: 'Plumbing Fixtures', budget: 86_000, brief: 'Unlacquered brass, heritage',
          options: [
            { product: 'Waterworks Henry collection', brand: 'Waterworks', total: 82_000, isChosen: true, query: 'waterworks henry faucet brass' },
            { product: 'Lefroy Brooks heritage', brand: 'Lefroy Brooks', total: 94_000, isChosen: false, query: 'lefroy brooks heritage faucet' },
            { product: 'Kallista Script collection', brand: 'Kallista', total: 88_000, isChosen: false, query: 'kallista script faucet' },
          ],
        },
        {
          name: 'Lighting Fixtures', budget: 88_000, brief: 'Sculptural, warm, dimmable',
          options: [
            { product: 'Apparatus + Roll & Hill mix', brand: 'Apparatus', total: 78_000, isChosen: true, query: 'apparatus studio chandelier' },
            { product: 'Lindsey Adelman set', brand: 'Lindsey Adelman', total: 96_000, isChosen: false, query: 'lindsey adelman chandelier' },
            { product: 'Rich Brilliant Willing', brand: 'RBW', total: 68_000, isChosen: false, query: 'rich brilliant willing pendant' },
          ],
        },
        {
          name: 'Stone Flooring', budget: 124_800, brief: 'Warm limestone & wide-plank oak transitions',
          options: [
            { product: 'French limestone, honed', brand: 'Exquisite Surfaces', total: 118_000, isChosen: false, query: 'french limestone flooring honed' },
            { product: 'Belgian bluestone', brand: 'Materials Marketing', total: 132_000, isChosen: false, query: 'belgian bluestone floor' },
            { product: 'Travertine, brushed', brand: 'Ann Sacks', total: 108_000, isChosen: false, query: 'travertine brushed floor tile' }, // none chosen — pending pick
          ],
        },
      ];
      const selectionsPromise = (async () => {
        for (const s of selSeeds) {
          const cat = await saveSelectionCategory({ projectId, category: s.name, budget: s.budget, styleBrief: s.brief });
          if (!cat) continue;
          const options: CuratedOption[] = [];
          for (const o of s.options) {
            let imageUrl: string | null = null;
            try { imageUrl = await resolveSelectionImage({ url: o.url, query: o.query }); } catch { imageUrl = null; }
            options.push({
              productName: o.product, brand: o.brand, description: '', unitPrice: o.total, unit: 'lump',
              quantity: 1, total: o.total, highlights: [], productUrl: o.url ?? '', imageUrl,
            });
          }
          await saveCuratedOptions(cat.id, options);
        }
        const fresh = await fetchSelectionsForProject(projectId);
        for (const s of selSeeds) {
          const liveCat = fresh.find((c) => c.category === s.name);
          if (!liveCat) continue;
          const chosen = s.options.find((o) => o.isChosen);
          if (!chosen) continue;
          const liveOpt = (liveCat.options ?? []).find((o) => o.productName === chosen.product);
          if (liveOpt) await chooseSelectionOption(liveCat.id, liveOpt.id, 'homeowner');
        }
      })();

      const waiverSeeds: { type: 'unconditional_partial' | 'conditional_partial' | 'unconditional_final'; sub: string; email: string; amount: number; throughDays: number; status: 'received' | 'signed' | 'requested'; signedAgo?: number }[] = [
        { type: 'unconditional_partial', sub: 'Ironline Structural', email: 'ap@ironline.example.com', amount: 640_800, throughDays: 24, status: 'received', signedAgo: 20 },
        { type: 'conditional_partial', sub: 'Summit Mechanical', email: 'billing@summitmech.example.com', amount: 147_000, throughDays: 14, status: 'signed', signedAgo: 12 },
        { type: 'conditional_partial', sub: 'Meridian Electric', email: 'ar@meridianelec.example.com', amount: 218_000, throughDays: 10, status: 'requested', signedAgo: undefined },
        { type: 'unconditional_partial', sub: 'Bayview Glass Systems', email: 'ap@bayviewglass.example.com', amount: 161_700, throughDays: 8, status: 'received', signedAgo: 6 },
      ];
      const waiversPromise = (async () => {
        for (const w of waiverSeeds) {
          await saveLienWaiver({
            projectId,
            waiverType: w.type,
            subName: w.sub,
            subEmail: w.email,
            paidAmount: w.amount,
            throughDate: dateDaysAgo(w.throughDays),
            status: w.status,
            signedAt: w.signedAgo != null ? isoDaysAgo(w.signedAgo) : undefined,
            subSignature: w.signedAgo != null ? { name: w.sub.split(' ')[0] + ' rep', role: 'gc' as const, signedAt: isoDaysAgo(w.signedAgo) } : undefined,
            notes: '',
          });
        }
      })();

      const binderPromise = saveCloseoutBinder({
        projectId,
        status: 'draft',
        notes: 'Closeout binder in progress — warranties, O&M manuals, and as-builts being compiled as trades finish. Will be delivered at substantial completion.',
        maintenanceSchedule: [
          ...DEFAULT_MAINTENANCE,
          { id: generateUUID(), task: 'Board-formed & stone reseal', frequency: 'Annual', notes: 'pH-neutral stone sealer; test with water bead.' },
          { id: generateUUID(), task: 'Green-roof drainage inspection', frequency: 'Semi-annual', notes: 'Clear drains before rainy season.' },
          { id: generateUUID(), task: 'Solar + battery firmware / production check', frequency: 'Annual', notes: 'Confirm production vs. baseline; update firmware.' },
        ],
      });

      await Promise.allSettled([contractPromise, selectionsPromise, waiversPromise, binderPromise]);

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt('Flagship project loaded');
      router.replace({ pathname: '/project-detail' as any, params: { id: projectId } });
    } catch (err) {
      console.error('[FlagshipSeeder] Failed to seed:', err);
      showAlert('Seed Failed', String(err));
    } finally {
      setSeeding(false);
    }
  }, [
    seeding, user, router,
    addProject, addInvoice, addDailyReport, addPunchItem, addProjectPhoto, addRFI, addChangeOrder,
    addPermit, savePermitRoadmap, addPlanSheet, savePlanReview, addPlanZone,
    addWarranty, addWarrantyClaim, addSubmittal, addAIAPayApp, addEquipment, addCOI,
    addPortalMessage, addCommitment, addSubcontractor, addContact, addOACMeeting,
    addJha, addToolboxTalk, addIncident, addHazard, addInspection, addCertification,
  ]);

  if (!ownerOk) {
    return <Redirect href="/(tabs)/(home)" />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Dev — Flagship Seeder</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <View style={styles.warningCard}>
          <AlertTriangle size={18} color={Colors.warning} strokeWidth={1.75} />
          <Text style={styles.warningText}>
            Owner-only screen. Only emails in OWNER_EMAILS (utils/owner.ts) reach here.
            Regular users get redirected home.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.cardIcon, { backgroundColor: themeColors.accent + '15' }]}>
            <MageAIMark size={28} color={themeColors.accent} />
          </View>
          <Text style={styles.cardTitle}>Load flagship project</Text>
          <Text style={styles.cardSub}>
            Creates &ldquo;The Overlook Estate&rdquo; — a $9.18M, 7,850 sf luxury hillside estate (GMP, open-book), mid-construction (~52% complete), with EVERYTHING populated for premium iOS + web screenshots:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bullet}>• 54-item estimate across 20+ CSI divisions + 42-task schedule w/ baseline, critical path, recovered steel slip</Text>
            <Text style={styles.bullet}>• 9 invoices (10% retention) · 12 daily reports · 7 change orders · 8 RFIs · 8 submittals · 16 punch items</Text>
            <Text style={styles.bullet}>• 12 site photos (2 marked up) · signed GMP contract · 6 milestones · 5 selection categories (with photos)</Text>
            <Text style={styles.bullet}>• 5 permits + roadmap · plan sheet + code review + 4 zones · 3 warranties (+claim) · AIA pay app · OAC meeting</Text>
            <Text style={styles.bullet}>• Safety: JHA · toolbox talk · near-miss · 3 hazards · site audit · 4 certs</Text>
            <Text style={styles.bullet}>• 4 subs + 4 contacts · 4 commitments · 3 equipment · 2 COIs · 4 lien waivers · 6 portal messages · closeout binder started</Text>
          </View>
          <Text style={styles.cardSubFine}>
            Numbers sum coherently and tell a healthy-job story. Also registers a reusable &ldquo;Luxury Hillside Estate&rdquo; schedule template.
          </Text>
          <TouchableOpacity
            style={[styles.cta, seeding && { opacity: 0.6 }]}
            onPress={seed}
            disabled={seeding}
            activeOpacity={0.85}
          >
            {seeding ? (
              <ActivityIndicator color={themeColors.surface} />
            ) : (
              <>
                <Gem size={16} color={themeColors.surface} strokeWidth={1.75} />
                <Text style={styles.ctaText}>Load flagship project</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerTitle: { ...Type.serifHeadline, color: t.text },
  warningCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    backgroundColor: Colors.warning + '12',
    borderRadius: Tokens.radius.card,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  warningText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17 },
  card: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 22,
    gap: 12,
    borderWidth: 1,
    borderColor: t.line,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cardTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.4 },
  cardSub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, lineHeight: 20 },
  cardSubFine: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 6, fontStyle: 'italic' as const },
  bulletList: { gap: 4, marginTop: 8, marginBottom: 8 },
  bullet: { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17 },
  cta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: t.accentFill,
    paddingVertical: 14,
    borderRadius: Tokens.radius.card,
    marginTop: 8,
  },
  ctaText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.surface },
});
