// app/dev-seeder.tsx — Owner-only demo data seeder.
//
// Press "Load demo project" and the screen seeds a fully-populated
// "marquee" construction project (estimate + schedule w/ baseline,
// photos, RFIs, invoices, daily reports, punch items, change orders,
// permits + inspection roadmap, plan sheet + code review + zones,
// warranties, submittals, AIA pay app, equipment, COIs, commitments,
// subs/contacts, client-portal thread, selections WITH product photos)
// so App Store screenshots and internal demos show every feature loaded
// instead of starting from a blank state.
//
// Gated to OWNER_EMAILS only (see utils/owner.ts). Regular users hitting
// /dev-seeder get bounced back to home — they don't need to see this.
//
// The seed is idempotent at the project level: it always creates a
// brand-new "Demo Project — <timestamp>" so repeat clicks don't collide.
// Old demo projects can be deleted from the home screen the same way as
// regular projects.
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, Redirect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Database, Trash2, AlertTriangle } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { isOwner } from '@/utils/owner';
import { generateUUID } from '@/utils/generateId';
import { nailIt } from '@/components/animations/NailItToast';
import type {
  Project, Invoice, DailyFieldReport, PunchItem, ProjectPhoto, ChangeOrder, PhotoMarkup,
  LinkedEstimate, ProjectSchedule, ScheduleTask,
  Permit, CodeFinding, Equipment,
  PortalMessage, Subcontractor, Contact,
} from '@/types';
// Wave 1-5 engines — seeded so screenshots show every feature loaded
// with realistic-looking data instead of empty states.
import { saveContract } from '@/utils/contractEngine';
import { saveSelectionCategory, saveCuratedOptions, chooseSelectionOption, fetchSelectionsForProject } from '@/utils/selectionsEngine';
import type { CuratedOption } from '@/utils/selectionsEngine';
import { resolveSelectionImage } from '@/utils/ogImage';
import { saveLienWaiver } from '@/utils/lienWaiverEngine';
import { saveCloseoutBinder, DEFAULT_MAINTENANCE } from '@/utils/closeoutBinderEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

export default function DevSeederScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { user } = useAuth();
  const {
    projects, addProject, deleteProject,
    addInvoice, addDailyReport, addPunchItem,
    addProjectPhoto, addRFI, addChangeOrder,
    // Marquee sub-collections (added in the full-demo upgrade).
    addPermit, savePermitRoadmap,
    addPlanSheet, savePlanReview, addPlanZone,
    addWarranty, addWarrantyClaim,
    addSubmittal,
    addAIAPayApp, addEquipment, addCOI,
    addPortalMessage, addCommitment,
    addSubcontractor, addContact,
  } = useProjects();

  const [seeding, setSeeding] = useState<boolean>(false);

  // Owner gate: anyone other than the platform owner gets bounced.
  // Computed up here (not as an early return) so the hooks below run
  // in the same order on every render — Rules of Hooks compliance.
  // The actual redirect happens just before the JSX render.
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
      // YYYY-MM-DD helper for fields that want a date (not a timestamp).
      const dateDaysAgo = (n: number) => isoDaysAgo(n).slice(0, 10);

      // Project started ~70 days ago and is ~45% complete. Schedule Day 1
      // anchors to that start so the Gantt, EVM, and lookahead all read as
      // a live mid-build job rather than something that hasn't begun.
      const PROJECT_START_DAYS_AGO = 70;
      const scheduleStartDate = dateDaysAgo(PROJECT_START_DAYS_AGO);
      const GRAND_TOTAL = 1_412_400; // marquee contract value (~$1.4M)

      // ─── Linked estimate (trade line items) ──────────────────────────
      // A real Schedule-of-Values-ish breakdown so the budget tile, job
      // cost, and AIA pay app all have line items to chew on. materialId
      // is a stable string so commitments / bid packages could reference
      // it later. Two items left as allowances (tile + lighting) to show
      // the allowance → firm-price story.
      const estItem = (
        materialId: string, name: string, category: string, csiDivision: string,
        unit: string, quantity: number, unitPrice: number, isAllowance?: boolean,
      ) => ({
        materialId, name, category, unit, quantity, unitPrice,
        bulkPrice: unitPrice, markup: 21, usesBulk: false,
        lineTotal: Math.round(quantity * unitPrice), supplier: '', csiDivision,
        ...(isAllowance ? { isAllowance: true } : {}),
      });
      const linkedEstimateItems = [
        estItem('li-gen', 'General conditions & supervision', 'General', '01', 'mo', 12, 9_500),
        estItem('li-site', 'Site work, excavation & utilities', 'Sitework', '31', 'ls', 1, 142_000),
        estItem('li-concrete', 'Foundation & flatwork (concrete)', 'Concrete', '03', 'cy', 320, 480),
        estItem('li-steel', 'Structural steel & timber frame', 'Structural', '05', 'ls', 1, 198_000),
        estItem('li-frame', 'Rough carpentry & framing', 'Carpentry', '06', 'ls', 1, 156_000),
        estItem('li-envelope', 'Roofing, windows & exterior envelope', 'Envelope', '07', 'ls', 1, 168_000),
        estItem('li-mep', 'MEP rough-in (HVAC / plumbing / electrical)', 'MEP', '23', 'ls', 1, 214_000),
        estItem('li-drywall', 'Insulation & drywall', 'Finishes', '09', 'sf', 4200, 9.5),
        estItem('li-millwork', 'Custom millwork & cabinetry', 'Finishes', '06', 'ls', 1, 132_000),
        estItem('li-floor', 'Hardwood & stone flooring', 'Finishes', '09', 'sf', 4200, 22),
        estItem('li-tile', 'Tile allowance (baths + kitchen)', 'Finishes', '09', 'ls', 1, 48_000, true),
        estItem('li-light', 'Lighting fixtures allowance', 'Electrical', '26', 'ls', 1, 36_000, true),
        estItem('li-pool', 'Infinity pool & deck', 'Sitework', '13', 'ls', 1, 124_000),
      ];
      const estBaseTotal = linkedEstimateItems.reduce((s, i) => s + i.lineTotal, 0);
      const linkedEstimate: LinkedEstimate = {
        id: generateUUID(),
        items: linkedEstimateItems,
        globalMarkup: 21,
        baseTotal: estBaseTotal,
        markupTotal: Math.round(estBaseTotal * 0.21),
        grandTotal: Math.round(estBaseTotal * 1.21),
        createdAt: isoDaysAgo(PROJECT_START_DAYS_AGO + 14),
      };

      // ─── Schedule (Gantt + EVM + variance) ───────────────────────────
      // ~45%-complete build. startDay offsets are from scheduleStartDate.
      // progress set per-task; a few tasks flagged isCriticalPath with
      // dependencies; a baseline is captured so variance/EVM render.
      // Upcoming milestones land in the next 1-2 weeks.
      const mkTask = (
        id: string, title: string, phase: string, startDay: number, durationDays: number,
        progress: number, crew: string, deps: string[], opts?: Partial<ScheduleTask>,
      ): ScheduleTask => ({
        id, title, phase, startDay, durationDays, progress, crew,
        crewSize: opts?.crewSize ?? 4,
        dependencies: deps,
        notes: opts?.notes ?? '',
        status: progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started',
        isMilestone: opts?.isMilestone,
        isCriticalPath: opts?.isCriticalPath,
        isWeatherSensitive: opts?.isWeatherSensitive,
        ...opts,
      });
      // ~70-day-elapsed build. Tasks before "today" (day 70) are done /
      // in-progress; tasks after are upcoming. Critical path runs through
      // the structural spine: site → foundation → steel → framing → dry-in.
      const scheduleTasks: ScheduleTask[] = [
        mkTask('t-permit', 'Permitting & approvals', 'Pre-Construction', 0, 18, 100, 'Office', [], { isCriticalPath: true }),
        mkTask('t-site', 'Site work & excavation', 'Sitework', 14, 16, 100, 'Earthworks', ['t-permit'], { isCriticalPath: true, isWeatherSensitive: true }),
        mkTask('t-found', 'Foundation & slab', 'Foundation', 28, 18, 100, 'Concrete', ['t-site'], { isCriticalPath: true, isWeatherSensitive: true }),
        mkTask('t-steel', 'Structural steel & timber', 'Structure', 44, 16, 80, 'Steel', ['t-found'], { isCriticalPath: true }),
        mkTask('t-frame', 'Rough framing', 'Structure', 56, 22, 55, 'Carpentry', ['t-steel'], { isCriticalPath: true }),
        mkTask('t-dryin', 'Roof & dry-in', 'Envelope', 74, 14, 20, 'Roofing', ['t-frame'], { isCriticalPath: true, isWeatherSensitive: true }),
        mkTask('t-mep', 'MEP rough-in', 'MEP', 80, 24, 10, 'MEP', ['t-frame']),
        mkTask('t-window', 'Windows & exterior doors', 'Envelope', 82, 10, 0, 'Glazing', ['t-dryin'], { isMilestone: false }),
        mkTask('t-insul', 'Insulation & drywall', 'Finishes', 104, 20, 0, 'Drywall', ['t-mep']),
        mkTask('t-millwork', 'Custom millwork & cabinetry', 'Finishes', 124, 26, 0, 'Millwork', ['t-insul']),
        mkTask('t-floor', 'Flooring & tile', 'Finishes', 132, 22, 0, 'Tile', ['t-insul']),
        mkTask('t-pool', 'Infinity pool & deck', 'Sitework', 120, 30, 0, 'Pool', ['t-frame'], { isWeatherSensitive: true }),
        mkTask('t-final', 'Final finishes & punch', 'Closeout', 150, 18, 0, 'GC', ['t-millwork', 't-floor']),
        mkTask('t-co', 'Certificate of Occupancy', 'Closeout', 168, 1, 0, 'Office', ['t-final'], { isMilestone: true, isCriticalPath: true }),
      ];
      const totalDuration = Math.max(...scheduleTasks.map(t => t.startDay + t.durationDays));
      const schedule: ProjectSchedule = {
        id: generateUUID(),
        name: 'Master Schedule',
        projectId,
        startDate: scheduleStartDate,
        workingDaysPerWeek: 5,
        bufferDays: 10,
        tasks: scheduleTasks,
        totalDurationDays: totalDuration,
        criticalPathDays: totalDuration,
        laborAlignmentScore: 86,
        healthScore: 82,
        riskItems: [
          { id: generateUUID(), title: 'Steel delivery on critical path', detail: 'Fabricator confirmed but any slip pushes framing and every successor.', severity: 'high' },
          { id: generateUUID(), title: 'Window lead time', detail: 'European glazing package quoted 12-week lead — verify against dry-in date.', severity: 'medium' },
        ],
        // Captured baseline so variance + EVM render. Most tasks track the
        // plan; a couple drifted a few days to make variance non-zero.
        baseline: {
          savedAt: isoDaysAgo(PROJECT_START_DAYS_AGO - 2),
          tasks: scheduleTasks.map(t => ({
            id: t.id,
            startDay: t.startDay,
            // Nudge a few downstream tasks so baseline ≠ current (variance).
            endDay: t.startDay + t.durationDays + (['t-frame', 't-dryin', 't-mep'].includes(t.id) ? -4 : 0),
          })),
        },
        updatedAt: isoNow,
      };

      // 1. The project itself — a ~4,200 sf high-end whole-home build in
      // Austin. Luxury finishes, mid-build (~45%), heavy activity across
      // every surface so EVERY screen has something real to render.
      const project = {
        id: projectId,
        name: 'The Westlake Residence',
        type: 'new_construction',
        location: '3401 Crystal Creek Dr, Austin TX 78746',
        squareFootage: 4200,
        quality: 'luxury',
        description: 'Ground-up custom whole-home build — 4,200 sf modern hill-country residence. Steel + timber frame, full smart-home, chef\'s kitchen, spa primary suite, infinity pool deck, 4 beds / 5.5 baths.',
        primaryContact: {
          name: 'Daniel & Sofia Marchetti',
          phone: '(512) 555-0147',
          email: 'sofia.marchetti@example.com',
        },
        leadSource: 'referral',
        createdAt: isoDaysAgo(PROJECT_START_DAYS_AGO),
        updatedAt: isoNow,
        estimate: {
          materialTotal: 512_000,
          laborTotal: 384_000,
          permits: 24_500,
          overhead: 96_000,
          contingency: 58_000,
          taxAmount: 88_400,
          totalCost: 1_162_900,
          markupPercent: 21,
          markupAmount: 244_209,
          grandTotal: GRAND_TOTAL,
          pricePerSqFt: 336.29,
          estimatedDuration: '11-12 months',
          materials: [],
        },
        status: 'in_progress',
        // Open-book contract mode so the portal shows the real cost
        // breakdown — useful for the "Open Book / GMP" screenshot.
        contractMode: 'open_book',
        contractorFeePercent: 21,
        // Marquee estimate + schedule (built as typed consts above so the
        // budget reads, and so the Gantt / EVM / variance all render).
        linkedEstimate,
        schedule,
        // Pre-populated client portal: homeowner invited, all sections
        // toggled on.
        clientPortal: {
          enabled: true,
          portalId: `portal-${projectId.slice(0, 8)}-demo`,
          showSchedule: true,
          showBudgetSummary: true,
          showInvoices: true,
          showChangeOrders: true,
          showPhotos: true,
          showDailyReports: true,
          showPunchList: true,
          showRFIs: true,
          showDocuments: false,
          welcomeMessage: 'Welcome to your live build portal! Everything — schedule, budget, photos, selections — updates here in real time. Message us any time.',
          coApprovalEnabled: true,
          clientCanSetBudget: false,
          homeownerLanguage: 'en',
          invites: [
            {
              id: generateUUID(),
              email: 'sofia.marchetti@example.com',
              name: 'Sofia Marchetti',
              createdAt: isoDaysAgo(64),
              viewedAt: isoDaysAgo(1),
            },
          ],
        },
        // Manual handover-day checks so the Handover Checklist
        // screenshot shows mixed status (computed + manual).
        handoverChecklist: {
          // walkthrough not yet done; keys not yet transferred. The
          // computed checks (selections / punch / binder / etc.) will
          // come back live from the underlying records.
        },
      } as unknown as Project;
      addProject(project);

      // 2. Invoices — 5 progress bills across the build.
      // Two paid, one partially paid, one sent (overdue), one draft.
      const invoiceData: Pick<Invoice, 'number' | 'type' | 'progressPercent' | 'issueDate' | 'dueDate' | 'totalDue' | 'amountPaid' | 'status'>[] = [
        { number: 1, type: 'progress', progressPercent: 15, issueDate: isoDaysAgo(40), dueDate: isoDaysAgo(10),  totalDue: 76_780, amountPaid: 76_780, status: 'paid' },
        { number: 2, type: 'progress', progressPercent: 30, issueDate: isoDaysAgo(28), dueDate: isoDaysAgo(0),   totalDue: 76_780, amountPaid: 76_780, status: 'paid' },
        { number: 3, type: 'progress', progressPercent: 45, issueDate: isoDaysAgo(14), dueDate: isoDaysAgo(-7),  totalDue: 76_780, amountPaid: 50_000, status: 'partially_paid' },
        { number: 4, type: 'progress', progressPercent: 60, issueDate: isoDaysAgo(2),  dueDate: isoDaysAgo(-19), totalDue: 76_780, amountPaid: 0,      status: 'sent' },
        { number: 5, type: 'progress', progressPercent: 75, issueDate: isoNow,         dueDate: isoDaysAgo(-30), totalDue: 76_780, amountPaid: 0,      status: 'draft' },
      ];
      for (const inv of invoiceData) {
        addInvoice({
          id: generateUUID(),
          projectId,
          number: inv.number,
          type: inv.type,
          progressPercent: inv.progressPercent,
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          paymentTerms: 'net_30',
          notes: '',
          lineItems: [
            { id: generateUUID(), description: `Progress billing — ${inv.progressPercent}% completion`, quantity: 1, unit: 'lump', unitPrice: inv.totalDue * 0.92, total: inv.totalDue * 0.92 },
          ],
          subtotal: inv.totalDue * 0.92,
          taxRate: 8.875,
          taxAmount: inv.totalDue * 0.08,
          totalDue: inv.totalDue,
          amountPaid: inv.amountPaid,
          status: inv.status,
          payments: inv.amountPaid > 0 ? [{ id: generateUUID(), amount: inv.amountPaid, method: 'check', receivedAt: inv.dueDate, reference: `Check #1${inv.number}042` }] : [],
          createdAt: inv.issueDate,
          updatedAt: isoNow,
        } as unknown as Invoice);
      }

      // 3. Daily field reports — last 14 days, weekday-only.
      const dfrTopics = [
        { weather: 'Sunny, 64°F', conditions: 'Clear', work: 'Demo of west wall complete. Carting removed 4 yards of debris. Started rough framing for the new kitchen island.', issues: '' },
        { weather: 'Cloudy, 58°F', conditions: 'Cloudy', work: 'MEP rough-in continues — electrical pulled to all 1F outlets. Plumbing rough for primary bath underway.', issues: 'Found old knob-and-tube in NE corner — RFI filed.' },
        { weather: 'Rain, 52°F', conditions: 'Rain', work: 'Indoor work only. Drywall delivery received and staged in basement. Insulation crew finished walls + ceiling on 2F.', issues: '' },
        { weather: 'Sunny, 67°F', conditions: 'Clear', work: 'Stucco patch on rear elevation. Mason finished chimney rebuild. Window install crew here for east-side replacements.', issues: '' },
        { weather: 'Partly Cloudy, 61°F', conditions: 'PartlyCloudy', work: 'HVAC ductwork in attic. Started taping drywall in primary bedroom + closets.', issues: '' },
        { weather: 'Sunny, 70°F', conditions: 'Clear', work: 'Tile delivery for primary bath. Plumber completed fixtures for hall bath. Began oak flooring install in living room.', issues: '' },
        { weather: 'Cloudy, 55°F', conditions: 'Cloudy', work: 'Painting prep on 2F bedrooms. Cabinet delivery pushed to next week per supplier.', issues: 'Cabinet delay flagged with owner — schedule impact 5 days.' },
        { weather: 'Sunny, 68°F', conditions: 'Clear', work: 'Floor refinish coat 1 — living + dining rooms. Started finish trim around new windows.', issues: '' },
      ];
      // Homeowner-friendly summaries paired with each technical DFR.
      // The most recent one is published to the portal so the "Latest
      // update" hero panel + the daily-report homeowner section both
      // have something to render in screenshots.
      const homeownerSummaries = [
        'We finished knocking down the last big wall in the back of the house and the dumpster guys came and hauled the old stuff away. Started building the new kitchen island today — by the end of the week the rough shape will be there.',
        'Today the electricians ran new wiring through the upstairs and the plumber started the rough work for your primary bath. We did find some really old wiring in the back corner that we\'ll need to discuss — nothing urgent, but I\'ll send a separate note.',
        'Rainy day so we kept everything indoors. The drywall was delivered and stacked in the basement, and the insulation crew finished the second-floor walls and ceiling. Should be a warm house this winter.',
        'Sunny day and we made good progress outside — patched the rear stucco, finished the chimney rebuild, and the new windows on the east side started going in. Looking really nice from the curb already.',
        'Quieter day on site. HVAC ducts are going in upstairs and we started taping drywall in the primary bedroom and closets. Tomorrow we\'ll be loud — flooring crew arrives.',
      ];
      dfrTopics.forEach((d, i) => {
        const date = isoDaysAgo(i * 2 + 1);
        const tempStr = d.weather.match(/([0-9]+)°/);
        // Publish the most recent (i=0) summary so the portal's
        // "Latest update" panel renders. Older summaries stay drafts.
        const isMostRecent = i === 0;
        addDailyReport({
          id: generateUUID(),
          projectId,
          date,
          weather: { temperature: tempStr ? `${tempStr[1]}°F` : '', conditions: d.conditions, wind: '', isManual: false },
          manpower: [
            { id: generateUUID(), trade: 'Carpentry', company: 'Henderson Build', headcount: 3, hoursWorked: 8 },
            { id: generateUUID(), trade: 'Electrical', company: 'Volt Bros Electric', headcount: 2, hoursWorked: 8 },
          ],
          workPerformed: d.work,
          materialsDelivered: i % 3 === 0 ? ['Drywall — 40 sheets', 'Insulation — R-21 rolls'] : [],
          issuesAndDelays: d.issues,
          incident: undefined,
          photos: [],
          status: i < 2 ? 'sent' : 'draft',
          recipientEmail: '',
          recipientName: '',
          // Wave 4: pre-seeded homeowner summary + publish flag on
          // the most recent so the portal's "Latest update" panel
          // has content immediately.
          homeownerSummary: homeownerSummaries[i] ?? undefined,
          homeownerSummaryGeneratedAt: homeownerSummaries[i] ? date : undefined,
          homeownerSummaryPublished: isMostRecent,
          createdAt: date,
          updatedAt: date,
        } as DailyFieldReport);
      });

      // 4. RFIs — 4 across various states.
      const rfiData = [
        { subject: 'Knob-and-tube wiring discovered in NE corner — replace or splice?', priority: 'urgent' as const, status: 'open' as const, assignedTo: 'D. Henderson (Architect)', daysAgo: 3, daysRequired: 2 },
        { subject: 'Confirm tile pattern for primary bath floor (matrix vs. herringbone)', priority: 'normal' as const, status: 'answered' as const, assignedTo: 'L. Henderson (Owner)', daysAgo: 12, daysRequired: -7 },
        { subject: 'Beam sizing for new kitchen island — engineered LVL spec?', priority: 'urgent' as const, status: 'answered' as const, assignedTo: 'M. Romano (Engineer)', daysAgo: 18, daysRequired: -10 },
        { subject: 'Window screen color — bronze or black?', priority: 'low' as const, status: 'closed' as const, assignedTo: 'L. Henderson (Owner)', daysAgo: 22, daysRequired: -15 },
      ];
      rfiData.forEach((r, i) => {
        addRFI({
          projectId,
          subject: r.subject,
          question: `${r.subject} Please advise so we can proceed without delay.`,
          priority: r.priority,
          status: r.status,
          assignedTo: r.assignedTo,
          dateSubmitted: isoDaysAgo(r.daysAgo),
          dateRequired: isoDaysAgo(r.daysRequired),
          dateResponded: r.status !== 'open' ? isoDaysAgo(r.daysAgo - 2) : undefined,
          response: r.status !== 'open' ? 'Confirmed — proceed as discussed on site walk-through.' : undefined,
          submittedBy: 'Henderson Build',
          linkedDrawing: i % 2 === 0 ? `A-10${i + 1}` : undefined,
          attachments: [],
        });
      });

      // 5. Punch items — 6 across statuses.
      const punchData = [
        { description: 'Touch-up paint above hallway light switch', priority: 'low' as const, status: 'open' as const, location: '2F Hallway', linkedSub: 'Brooks Painting' },
        { description: 'Outlet cover plate missing in primary closet', priority: 'medium' as const, status: 'open' as const, location: 'Primary Bedroom — Closet', linkedSub: 'Volt Bros Electric' },
        { description: 'Caulk gap between tub and tile in hall bath', priority: 'medium' as const, status: 'in_progress' as const, location: '2F Hall Bath', linkedSub: 'Tilework Inc' },
        { description: 'Squeaky floorboard in dining room', priority: 'low' as const, status: 'in_progress' as const, location: 'Dining Room', linkedSub: 'Henderson Build' },
        { description: 'Replace cracked window pane (received during install)', priority: 'high' as const, status: 'closed' as const, location: 'East Bedroom', linkedSub: 'Henderson Build' },
        { description: 'Sand and re-stain banister handrail', priority: 'medium' as const, status: 'closed' as const, location: 'Stairwell', linkedSub: 'Brooks Painting' },
      ];
      punchData.forEach((p) => {
        const id = generateUUID();
        const created = isoDaysAgo(Math.floor(Math.random() * 20) + 5);
        addPunchItem({
          id,
          projectId,
          description: p.description,
          location: p.location,
          priority: p.priority,
          status: p.status,
          createdAt: created,
          updatedAt: isoNow,
          closedAt: p.status === 'closed' ? isoDaysAgo(2) : undefined,
          assignedTo: p.linkedSub,
          notes: '',
          photos: [],
        } as unknown as PunchItem);
      });

      // 6. Project photos — 8 placeholder entries with real-looking
      // metadata (tags, locations). URIs are pixel placeholders so the
      // grid renders something visible.
      const photoTags = ['before', 'progress', 'progress', 'progress', 'progress', 'after', 'after', 'before'];
      const photoLocations = ['Kitchen — west wall', 'Primary bath rough-in', 'Living room subfloor', 'Stairwell framing', 'East elevation', 'Kitchen island', 'Dining room finish', 'Mechanical room'];
      // One photo gets sample markup so the photo annotator + the
      // photo-with-markup screenshot have something realistic to show.
      const sampleMarkup: PhotoMarkup[] = [
        { id: generateUUID(), type: 'arrow',  color: 'red',    points: [{ x: 0.18, y: 0.38 }, { x: 0.42, y: 0.55 }] },
        { id: generateUUID(), type: 'circle', color: 'yellow', points: [{ x: 0.55, y: 0.30 }, { x: 0.78, y: 0.55 }] },
        { id: generateUUID(), type: 'text',   color: 'red',    points: [{ x: 0.18, y: 0.30 }], text: 'Hairline crack' },
      ];
      photoTags.forEach((tag, i) => {
        addProjectPhoto({
          id: generateUUID(),
          projectId,
          uri: `https://picsum.photos/seed/mage-demo-${i}/640/480`,
          timestamp: isoDaysAgo(30 - i * 3),
          location: photoLocations[i],
          tag,
          // Mark up photo #2 (the primary bath rough-in) so screenshots
          // of the gallery + lightbox can show the badge + overlay.
          markup: i === 1 ? sampleMarkup : undefined,
          latitude: 40.6712 + (Math.random() - 0.5) * 0.001,
          longitude: -73.9876 + (Math.random() - 0.5) * 0.001,
        } as ProjectPhoto);
      });

      // 7. One approved change order to make Money tab look real.
      addChangeOrder({
        id: generateUUID(),
        projectId,
        number: 1,
        date: isoDaysAgo(15),
        description: 'Owner-requested upgrade: subway tile → marble herringbone for primary bath',
        reason: 'Owner direction at site walk',
        status: 'approved',
        scheduleImpactDays: 3,
        originalContractValue: 511_863,
        changeAmount: 4_280,
        newContractTotal: 516_143,
        lineItems: [
          { id: generateUUID(), description: 'Marble tile (herringbone) — primary bath', quantity: 110, unit: 'sf', unitPrice: 24.50, total: 2_695 },
          { id: generateUUID(), description: 'Additional labor for herringbone install', quantity: 1, unit: 'lump', unitPrice: 1_585, total: 1_585 },
        ],
        createdAt: isoDaysAgo(15),
        updatedAt: isoNow,
      } as unknown as ChangeOrder);

      // ─── Wave 1-5 features ─────────────────────────────────────────
      // Seed every premium feature so screenshots and demos don't have
      // to start from scratch. All async — wrapped in Promise.allSettled
      // so a failure in one doesn't block the rest.

      // 8. Project Contract — fully signed by both parties so the
      //    "Contract" tile shows the SIGNED status pill, and so the
      //    contract preview screenshot has signatures on both sides.
      const contractPromise = saveContract({
        projectId,
        version: 1,
        title: 'Marchetti Residence — Construction Agreement',
        contractValue: GRAND_TOTAL,
        scopeText:
          'Ground-up construction of a 4,200 sf custom hill-country residence. Steel + timber frame, full smart-home, chef\'s kitchen, spa primary suite, infinity pool deck, 4 beds / 5.5 baths.',
        termsText: 'Open-book cost-plus with a 21% fee. Payment per milestone schedule below. Either party may terminate for material breach with 30 days notice.',
        warrantyText: 'Twelve-month workmanship warranty from date of substantial completion. Manufacturer warranties pass through to homeowner where applicable.',
        startDate: isoDaysAgo(PROJECT_START_DAYS_AGO),
        durationDays: 350,
        paymentSchedule: [
          { id: generateUUID(), label: 'Deposit', trigger: 'on_signing', amount: 211_860, percent: 15, status: 'paid', paidAt: isoDaysAgo(72) },
          { id: generateUUID(), label: 'Foundation complete', trigger: 'on_milestone', amount: 211_860, percent: 15, status: 'paid', paidAt: isoDaysAgo(40) },
          { id: generateUUID(), label: 'Structure complete', trigger: 'on_milestone', amount: 282_480, percent: 20, status: 'invoiced', invoicedAt: isoDaysAgo(6) },
          { id: generateUUID(), label: 'Dry-in + MEP rough complete', trigger: 'on_milestone', amount: 282_480, percent: 20, status: 'pending' },
          { id: generateUUID(), label: 'Substantial completion', trigger: 'on_milestone', amount: 282_480, percent: 20, status: 'pending' },
          { id: generateUUID(), label: 'Final + punch list', trigger: 'on_final', amount: 141_240, percent: 10, status: 'pending' },
        ],
        // Allowances — mirror the selection categories seeded below so the
        // allowance → selection → (over-allowance) CO story reads end-to-end.
        allowances: [
          { id: generateUUID(), category: 'Kitchen Faucet', amount: 1_800, description: 'Pro-style pull-down' },
          { id: generateUUID(), category: 'Bathroom Tile', amount: 12_000, description: 'Primary + hall baths' },
          { id: generateUUID(), category: 'Lighting Fixtures', amount: 6_500, description: 'Whole house, owner-selected' },
          { id: generateUUID(), category: 'Plumbing Fixtures', amount: 9_800, description: 'Faucets, sinks, toilets' },
          { id: generateUUID(), category: 'Hardwood Flooring', amount: 14_200, description: 'Main level + bedrooms' },
        ],
        gcSignature: { name: 'Westlake Builders LLC', role: 'gc', signedAt: isoDaysAgo(72) },
        homeownerSignature: { name: 'Daniel Marchetti', role: 'homeowner', signedAt: isoDaysAgo(71) },
        signedAt: isoDaysAgo(71),
        status: 'signed',
      });

      // 9. Selection Categories — five, with chosen options spanning
      //    budget / on-target / premium tiers. ONE category is over
      //    allowance to demonstrate the "Draft Change Order" CTA. Each
      //    option carries a real product `url` (and a `query` fallback) so
      //    the seeder can resolve a product PHOTO via resolveSelectionImage
      //    — this is what showcases the new image-rich selections feature.
      type SelOpt = { product: string; brand: string; total: number; isChosen: boolean; url?: string; query?: string };
      const selSeeds: { name: string; budget: number; brief: string; options: SelOpt[] }[] = [
        {
          name: 'Kitchen Faucet', budget: 1800, brief: 'Pull-down, polished nickel, pro-style',
          options: [
            { product: 'Purist pull-down', brand: 'Kohler', total: 950, isChosen: false, url: 'https://www.build.com/kohler-k-7505/s1116339', query: 'kohler purist kitchen faucet polished nickel' },
            { product: 'Litze pull-down', brand: 'Brizo', total: 1_650, isChosen: true, url: 'https://www.build.com/brizo-63043lf/s1389765', query: 'brizo litze kitchen faucet nickel' }, // on-target chosen
            { product: 'Waterstone Gantry', brand: 'Waterstone', total: 2_400, isChosen: false, url: 'https://www.build.com/waterstone-5600/s1452210', query: 'waterstone gantry kitchen faucet' },
          ],
        },
        {
          name: 'Bathroom Tile', budget: 12000, brief: 'Spa feel, marble or marble-look',
          options: [
            { product: 'Carrara honed 12x24', brand: 'Daltile', total: 9_200, isChosen: false, url: 'https://www.homedepot.com/b/Flooring-Tile/Carrara/N-5yc1vZar5tZ1z141sd', query: 'carrara marble tile 12x24 honed' },
            { product: 'Statuario polished hex', brand: 'Ann Sacks', total: 11_800, isChosen: false, query: 'statuario marble hexagon tile' },
            { product: 'Calacatta gold herringbone', brand: 'Walker Zanger', total: 16_400, isChosen: true, query: 'calacatta gold herringbone marble tile' }, // OVER allowance — triggers CO CTA
          ],
        },
        {
          name: 'Lighting Fixtures', budget: 6500, brief: 'Warm, dimmable, modern organic',
          options: [
            { product: 'Cedar & Moss pendant set', brand: 'Cedar & Moss', total: 4_800, isChosen: true, url: 'https://www.cedarandmoss.com/products/alto-pendant', query: 'modern brass pendant light' }, // budget chosen
            { product: 'Hudson Valley brass family', brand: 'Hudson Valley', total: 6_700, isChosen: false, query: 'hudson valley brass chandelier' },
            { product: 'Apparatus + Roll & Hill', brand: 'Apparatus', total: 11_400, isChosen: false, query: 'apparatus studio modern chandelier' },
          ],
        },
        {
          name: 'Plumbing Fixtures', budget: 9800, brief: 'Polished nickel, classic',
          options: [
            { product: 'Kohler Artifacts complete', brand: 'Kohler', total: 8_400, isChosen: false, query: 'kohler artifacts faucet polished nickel' },
            { product: 'Waterworks Henry collection', brand: 'Waterworks', total: 9_700, isChosen: true, query: 'waterworks henry faucet nickel' },  // on-target
            { product: 'Lefroy Brooks heritage', brand: 'Lefroy Brooks', total: 14_200, isChosen: false, query: 'lefroy brooks heritage faucet' },
          ],
        },
        {
          name: 'Hardwood Flooring', budget: 14200, brief: 'White oak, wide plank, matte finish',
          options: [
            { product: '4-inch white oak Natural', brand: 'Carlisle', total: 11_800, isChosen: false, query: 'white oak wide plank flooring matte' },
            { product: '7-inch white oak Pickled', brand: 'Carlisle', total: 13_900, isChosen: false, query: 'white oak pickled wide plank floor' },
            { product: '8-inch rift+quartered Custom', brand: 'Carlisle', total: 17_600, isChosen: false, query: 'rift quartered white oak floor' },  // none chosen — pending pick
          ],
        },
      ];

      const selectionsPromise = (async () => {
        // 1) Save each category + its options. Resolve a product photo per
        //    option first (best-effort; null when og-image / Supabase isn't
        //    reachable — the save still proceeds photo-less).
        for (const s of selSeeds) {
          const cat = await saveSelectionCategory({
            projectId,
            category: s.name,
            budget: s.budget,
            styleBrief: s.brief,
          });
          if (!cat) continue;
          const options: CuratedOption[] = [];
          for (const o of s.options) {
            let imageUrl: string | null = null;
            try {
              imageUrl = await resolveSelectionImage({ url: o.url, query: o.query });
            } catch { imageUrl = null; }
            options.push({
              productName: o.product,
              brand: o.brand,
              description: '',
              unitPrice: o.total,
              unit: 'lump',
              quantity: 1,
              total: o.total,
              highlights: [],
              productUrl: o.url ?? '',
              imageUrl,
            });
          }
          await saveCuratedOptions(cat.id, options);
        }
        // 2) Re-fetch so we know the persisted option ids, then mark
        //    each chosen one in a second pass.
        const fresh = await fetchSelectionsForProject(projectId);
        for (const seed of selSeeds) {
          const liveCat = fresh.find(c => c.category === seed.name);
          if (!liveCat) continue;
          const seedChosenIdx = seed.options.findIndex(o => o.isChosen);
          if (seedChosenIdx < 0) continue;
          const targetProduct = seed.options[seedChosenIdx].product;
          const liveOpt = (liveCat.options ?? []).find(o => o.productName === targetProduct);
          if (liveOpt) {
            await chooseSelectionOption(liveCat.id, liveOpt.id, 'homeowner');
          }
        }
      })();

      // 10. Lien Waivers — four in different statuses to populate the
      //     full lien-waivers screen.
      const waiverSeeds = [
        { type: 'unconditional_partial' as const, sub: 'Volt Bros Electric',  email: 'shop@voltbros.com',     amount: 18_400, throughDays: 8,  status: 'received' as const, gotSignedAt: isoDaysAgo(6) },
        { type: 'conditional_partial' as const,   sub: 'Park Slope Plumbing', email: 'office@psplumbing.com', amount: 22_800, throughDays: 14, status: 'signed' as const,   gotSignedAt: isoDaysAgo(12) },
        { type: 'conditional_partial' as const,   sub: 'Brooks Painting',     email: 'mike@brookspaint.com',  amount: 8_900,  throughDays: 5,  status: 'requested' as const, gotSignedAt: undefined },
        { type: 'unconditional_final' as const,   sub: 'Romano Engineering',  email: 'mr@romanoengineering.com', amount: 4_500, throughDays: 30, status: 'received' as const, gotSignedAt: isoDaysAgo(28) },
      ];
      const waiversPromise = (async () => {
        for (const w of waiverSeeds) {
          await saveLienWaiver({
            projectId,
            waiverType: w.type,
            subName: w.sub,
            subEmail: w.email,
            paidAmount: w.amount,
            throughDate: isoDaysAgo(w.throughDays).slice(0, 10),
            status: w.status,
            signedAt: w.gotSignedAt,
            subSignature: w.gotSignedAt
              ? { name: w.sub.split(' ')[0] + ' rep', role: 'gc' as const, signedAt: w.gotSignedAt }
              : undefined,
            notes: '',
          });
        }
      })();

      // 11. Closeout Binder — finalized + delivered, with custom note.
      //     Status='sent' so the binder shows up in the homeowner's
      //     portal and the project-detail tile shows DELIVERED.
      //     Also so the Handover Checklist's "binder delivered" item
      //     auto-ticks.
      const binderPromise = saveCloseoutBinder({
        projectId,
        status: 'sent',
        finalizedAt: isoDaysAgo(3),
        sentAt: isoDaysAgo(2),
        notes:
          'Daniel + Sofia — congratulations on the new home. Everything you need to maintain it is in here. Call any time, especially in the first year while warranties are live.\n\n— The Westlake build team',
        maintenanceSchedule: [
          ...DEFAULT_MAINTENANCE,
          { id: generateUUID(), task: 'Marble countertop reseal', frequency: 'Annual', notes: 'Use pH-neutral stone sealer. Test with water bead.' },
          { id: generateUUID(), task: 'Hardwood floor inspection', frequency: 'Annual', notes: 'Look for separation in heating season. Re-coat every 5-7 years.' },
        ],
      });

      // Fire all the wave 1-5 seeders in parallel; wait but tolerate
      // partial failures so a single broken table doesn't blank the
      // whole demo.
      await Promise.allSettled([
        contractPromise, selectionsPromise, waiversPromise, binderPromise,
      ]);

      // ─── Marquee sub-collections ───────────────────────────────────
      // Every block is guarded in its own try/catch so one bad domain
      // can't break the rest of the seed. All reference `projectId` and
      // run AFTER addProject above. Dates anchor to the same "today".
      const portalId = `portal-${projectId.slice(0, 8)}-demo`;

      // 12. Permits — building / electrical / plumbing / mechanical,
      //     mixed statuses, with inspection dates.
      try {
        const permitSeeds: { type: Permit['type']; status: Permit['status']; jurisdiction: string; fee: number; appliedAgo: number; approvedAgo?: number; inspectionAgo?: number; phase: string; notes: string }[] = [
          { type: 'building', status: 'approved', jurisdiction: 'City of Austin DSD', fee: 14_200, appliedAgo: 66, approvedAgo: 52, phase: 'Foundation', notes: 'Master building permit — issued.' },
          { type: 'electrical', status: 'inspection_passed', jurisdiction: 'City of Austin DSD', fee: 3_400, appliedAgo: 40, approvedAgo: 30, inspectionAgo: 6, phase: 'Rough-in', notes: 'Rough electrical inspection passed.' },
          { type: 'plumbing', status: 'inspection_scheduled', jurisdiction: 'City of Austin DSD', fee: 2_900, appliedAgo: 38, approvedAgo: 28, inspectionAgo: -4, phase: 'Rough-in', notes: 'Top-out inspection scheduled.' },
          { type: 'mechanical', status: 'under_review', jurisdiction: 'City of Austin DSD', fee: 2_600, appliedAgo: 10, phase: 'Rough-in', notes: 'HVAC permit in plan review.' },
        ];
        for (const p of permitSeeds) {
          addPermit({
            projectId,
            projectName: project.name,
            type: p.type,
            permitNumber: p.status === 'under_review' ? undefined : `${p.type.slice(0, 3).toUpperCase()}-2026-${Math.floor(1000 + Math.random() * 8999)}`,
            jurisdiction: p.jurisdiction,
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
      } catch (err) { console.warn('[DevSeeder] permits block failed:', err); }

      // 13. Permit & Inspection Roadmap — RoadmapPermit + RoadmapInspection
      //     items with a status mix; gatesTaskHint matches schedule phases.
      try {
        savePermitRoadmap({
          id: generateUUID(),
          projectId,
          generatedAt: isoDaysAgo(60),
          scopeHash: `demo-${projectId.slice(0, 8)}`,
          permits: [
            { id: generateUUID(), type: 'building', title: 'Master building permit', description: 'Full new-construction building permit for the residence.', whoPulls: 'gc', leadTimeDays: 21, status: 'approved' },
            { id: generateUUID(), type: 'electrical', title: 'Electrical permit', description: 'Service + rough + final electrical.', whoPulls: 'sub', leadTimeDays: 7, status: 'approved' },
            { id: generateUUID(), type: 'plumbing', title: 'Plumbing permit', description: 'Water, sewer, gas rough + top-out.', whoPulls: 'sub', leadTimeDays: 7, status: 'applied' },
            { id: generateUUID(), type: 'mechanical', title: 'Mechanical / HVAC permit', description: 'Two-zone HVAC + ERV.', whoPulls: 'sub', leadTimeDays: 7, status: 'needed' },
          ],
          inspections: [
            { id: generateUUID(), type: 'foundation', title: 'Foundation / pre-pour inspection', description: 'Rebar + forms before concrete.', gatesTaskHint: 'Foundation & slab', leadTimeDays: 2, status: 'passed' },
            { id: generateUUID(), type: 'framing', title: 'Framing inspection', description: 'Structure + shear before cover.', gatesTaskHint: 'Rough framing', leadTimeDays: 2, status: 'scheduled' },
            { id: generateUUID(), type: 'rough_mep', title: 'Rough MEP inspection', description: 'Electrical, plumbing, mechanical rough before insulation.', gatesTaskHint: 'MEP rough-in', leadTimeDays: 2, status: 'pending' },
            { id: generateUUID(), type: 'final', title: 'Final / CO inspection', description: 'Certificate of Occupancy walk.', gatesTaskHint: 'Certificate of Occupancy', leadTimeDays: 3, status: 'pending' },
          ],
        });
      } catch (err) { console.warn('[DevSeeder] permit roadmap block failed:', err); }

      // 14. Plan sheet + Plan Review (code findings) + Plan zones.
      //     addPlanSheet returns the sheet so review + zones can link to it.
      try {
        const planSheet = addPlanSheet({
          projectId,
          name: 'A-201 Main Level Floor Plan',
          sheetNumber: 'A-201',
          imageUri: 'https://picsum.photos/seed/mage-plan-a201/1400/1000',
          pageNumber: 1,
          width: 1400,
          height: 1000,
        });

        // Plan Review — ~4 code findings across severities / categories /
        // statuses so the red-line review screen renders fully.
        const findings: CodeFinding[] = [
          { id: generateUUID(), category: 'egress', codeRef: 'IRC R310.2.1', requirement: 'Emergency escape opening min 5.7 sf, sill ≤ 44".', observed: 'Bedroom 3 window sill scales to 48" — exceeds max.', severity: 'high', confidence: 'high', status: 'open' },
          { id: generateUUID(), category: 'stairs', codeRef: 'IRC R311.7.5', requirement: 'Riser ≤ 7-3/4", tread ≥ 10".', observed: 'Main stair riser noted 7-7/8" on section A.', severity: 'med', confidence: 'med', status: 'open' },
          { id: generateUUID(), category: 'guards', codeRef: 'IRC R312.1.2', requirement: 'Guard height ≥ 36" where drop > 30".', observed: 'Pool-deck guard appears 34" on elevation.', severity: 'med', confidence: 'low', status: 'resolved' },
          { id: generateUUID(), category: 'ada', codeRef: 'ANSI A117.1', requirement: 'Clear floor space at primary bath fixtures.', observed: 'Confirmed adequate after layout revision.', severity: 'low', confidence: 'high', status: 'dismissed' },
        ];
        savePlanReview({
          id: generateUUID(),
          projectId,
          planSheetId: planSheet.id,
          reviewedAt: isoDaysAgo(20),
          findings,
        });

        // Plan zones (Living Floor Plan) — 3 rectangles linked to tasks.
        addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.06, y: 0.10, w: 0.40, h: 0.34, label: 'Chef\'s Kitchen', linkedTaskIds: ['t-millwork', 't-mep'], color: '#F97316' });
        addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.52, y: 0.10, w: 0.42, h: 0.40, label: 'Great Room', linkedTaskIds: ['t-frame', 't-floor'], color: '#3B82F6' });
        addPlanZone({ projectId, planSheetId: planSheet.id, x: 0.10, y: 0.52, w: 0.38, h: 0.40, label: 'Primary Suite', linkedTaskIds: ['t-insul', 't-floor'], color: '#10B981' });
      } catch (err) { console.warn('[DevSeeder] plan sheet / review / zones block failed:', err); }

      // 15. Warranties — 2, plus one claim on the first.
      try {
        const roofWarranty = addWarranty({
          projectId,
          projectName: project.name,
          title: 'Standing-seam metal roof — 40yr',
          category: 'roofing',
          description: 'Manufacturer + workmanship warranty on the standing-seam roof assembly.',
          provider: 'Hill Country Roofing / Drexel Metals',
          startDate: dateDaysAgo(20),
          durationMonths: 480,
          endDate: dateDaysAgo(20 - 480 * 30),
          coverageDetails: 'Material 40yr, finish 30yr, workmanship 10yr.',
        });
        addWarranty({
          projectId,
          projectName: project.name,
          title: 'HVAC system — 10yr parts',
          category: 'hvac',
          description: 'Two-zone variable-speed system + ERV.',
          provider: 'Trane / Lone Star Mechanical',
          startDate: dateDaysAgo(5),
          durationMonths: 120,
          endDate: dateDaysAgo(5 - 120 * 30),
          coverageDetails: 'Compressor + parts 10yr with registration.',
        });
        if (roofWarranty?.id) {
          addWarrantyClaim(roofWarranty.id, {
            date: dateDaysAgo(8),
            description: 'Minor flashing drip noted at the south valley after heavy rain.',
            resolution: 'Re-sealed valley flashing; re-tested under hose. No interior damage.',
            resolvedAt: dateDaysAgo(6),
            cost: 0,
          });
        }
      } catch (err) { console.warn('[DevSeeder] warranties block failed:', err); }

      // 16. Submittals — 3. One carries multiple review cycles inline
      //     (addReviewCycle reads context state that won't yet include a
      //     freshly-seeded submittal, so cycles are seeded on the record).
      try {
        addSubmittal({
          projectId,
          title: 'Structural steel shop drawings',
          specSection: '05 12 00',
          submittedBy: 'Lone Star Steel Fab',
          submittedDate: dateDaysAgo(40),
          requiredDate: dateDaysAgo(26),
          currentStatus: 'approved_as_noted',
          attachments: [],
          reviewCycles: [
            { cycleNumber: 1, sentDate: dateDaysAgo(40), returnDate: dateDaysAgo(34), reviewer: 'SEOR — Watershed Engineering', status: 'revise_resubmit', comments: 'Revise moment connection at GL-3; confirm anchor embed.' },
            { cycleNumber: 2, sentDate: dateDaysAgo(32), returnDate: dateDaysAgo(27), reviewer: 'SEOR — Watershed Engineering', status: 'approved_as_noted', comments: 'Approved as noted. Field-verify embed depth.' },
          ],
        });
        addSubmittal({
          projectId,
          title: 'Window & door schedule (European tilt-turn)',
          specSection: '08 50 00',
          submittedBy: 'Glasswerks ATX',
          submittedDate: dateDaysAgo(18),
          requiredDate: dateDaysAgo(-3),
          currentStatus: 'in_review',
          attachments: [],
          reviewCycles: [
            { cycleNumber: 1, sentDate: dateDaysAgo(18), reviewer: 'Architect — Studio Meridian', status: 'in_review' },
          ],
        });
        addSubmittal({
          projectId,
          title: 'Engineered hardwood — white oak',
          specSection: '09 64 00',
          submittedBy: 'Austin Hardwoods',
          submittedDate: dateDaysAgo(9),
          requiredDate: dateDaysAgo(-12),
          currentStatus: 'pending',
          attachments: [],
          reviewCycles: [],
        });
      } catch (err) { console.warn('[DevSeeder] submittals block failed:', err); }

      // 17. AIA G702/G703 pay application — one, with SOV lines + totals.
      try {
        const sovDefs: { itemNo: string; description: string; scheduledValue: number; pctComplete: number }[] = [
          { itemNo: '01', description: 'General conditions', scheduledValue: 114_000, pctComplete: 58 },
          { itemNo: '02', description: 'Site work & excavation', scheduledValue: 142_000, pctComplete: 100 },
          { itemNo: '03', description: 'Foundation & flatwork', scheduledValue: 153_600, pctComplete: 100 },
          { itemNo: '05', description: 'Structural steel & timber', scheduledValue: 198_000, pctComplete: 80 },
          { itemNo: '06', description: 'Rough framing', scheduledValue: 156_000, pctComplete: 55 },
          { itemNo: '07', description: 'Roofing & envelope', scheduledValue: 168_000, pctComplete: 20 },
          { itemNo: '23', description: 'MEP rough-in', scheduledValue: 214_000, pctComplete: 10 },
        ];
        const retPct = 10;
        const lines = sovDefs.map((s) => {
          const completed = Math.round(s.scheduledValue * (s.pctComplete / 100));
          const thisPeriod = Math.round(completed * 0.35);
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
        const lessPreviousCertificates = Math.round(totalEarnedLessRetainage * 0.7);
        addAIAPayApp({
          id: generateUUID(),
          projectId,
          applicationNumber: 4,
          applicationDate: dateDaysAgo(2),
          periodTo: dateDaysAgo(2),
          contractDate: dateDaysAgo(PROJECT_START_DAYS_AGO),
          ownerName: 'Daniel & Sofia Marchetti',
          contractorName: 'Westlake Builders LLC',
          architectName: 'Studio Meridian Architecture',
          projectName: project.name,
          projectLocation: project.location,
          contractForDescription: 'New custom residence — ground-up construction',
          originalContractSum: GRAND_TOTAL,
          netChangeByCO: 18_650,
          contractSumToDate: GRAND_TOTAL + 18_650,
          retainagePercent: retPct,
          lessPreviousCertificates,
          lines,
          notes: 'Application No. 4 — period ending this week.',
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
      } catch (err) { console.warn('[DevSeeder] AIA pay app block failed:', err); }

      // 18. Subcontractors / contacts (referenced by COIs + commitments).
      const subSteelId = generateUUID();
      const subMepId = generateUUID();
      try {
        const subDefs: { id: string; company: string; contact: string; trade: Subcontractor['trade']; phone: string; email: string }[] = [
          { id: subSteelId, company: 'Lone Star Steel Fab', contact: 'Ray Tucker', trade: 'General', phone: '(512) 555-0188', email: 'ray@lonestarsteel.example.com' },
          { id: subMepId, company: 'Lone Star Mechanical', contact: 'Priya Nadeem', trade: 'HVAC', phone: '(512) 555-0211', email: 'priya@lsmech.example.com' },
        ];
        for (const s of subDefs) {
          addSubcontractor({
            id: s.id,
            companyName: s.company,
            contactName: s.contact,
            phone: s.phone,
            email: s.email,
            address: 'Austin, TX',
            trade: s.trade,
            licenseNumber: `TX-${Math.floor(100000 + Math.random() * 899999)}`,
            licenseExpiry: dateDaysAgo(-300),
            coiExpiry: dateDaysAgo(-180),
            w9OnFile: true,
            bidHistory: [],
            assignedProjects: [projectId],
            notes: '',
            createdAt: isoDaysAgo(60),
            updatedAt: isoNow,
          });
        }
        const contactDefs: { first: string; last: string; company: string; role: Contact['role']; email: string; phone: string }[] = [
          { first: 'Elena', last: 'Reyes', company: 'Studio Meridian Architecture', role: 'Architect', email: 'elena@studiomeridian.example.com', phone: '(512) 555-0102' },
          { first: 'Marcus', last: 'Webb', company: 'Watershed Engineering', role: 'Engineer', email: 'mwebb@watershed.example.com', phone: '(512) 555-0133' },
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
            address: 'Austin, TX',
            notes: '',
            linkedProjectIds: [projectId],
            createdAt: isoDaysAgo(62),
            updatedAt: isoNow,
          });
        }
      } catch (err) { console.warn('[DevSeeder] subs / contacts block failed:', err); }

      // 19. Equipment — 2 (owned + rented).
      try {
        const equipDefs: { name: string; type: Equipment['type']; category: Equipment['category']; make: string; model: string; rate: number; status: Equipment['status'] }[] = [
          { name: 'Tower crane', type: 'rented', category: 'lifting', make: 'Potain', model: 'MDT 219', rate: 1_250, status: 'in_use' },
          { name: 'Skid steer', type: 'owned', category: 'excavation', make: 'Bobcat', model: 'S770', rate: 320, status: 'in_use' },
        ];
        for (const e of equipDefs) {
          addEquipment({
            name: e.name,
            type: e.type,
            category: e.category,
            make: e.make,
            model: e.model,
            year: 2023,
            dailyRate: e.rate,
            currentProjectId: projectId,
            maintenanceSchedule: [],
            utilizationLog: [
              { id: generateUUID(), equipmentId: 'pending', projectId, date: dateDaysAgo(7), hoursUsed: 8, operatorName: 'Site crew' },
              { id: generateUUID(), equipmentId: 'pending', projectId, date: dateDaysAgo(3), hoursUsed: 6, operatorName: 'Site crew' },
            ],
            status: e.status,
          });
        }
      } catch (err) { console.warn('[DevSeeder] equipment block failed:', err); }

      // 20. COIs — 2, tied to the seeded subs.
      try {
        const coiDefs: { subId: string }[] = [{ subId: subSteelId }, { subId: subMepId }];
        for (const c of coiDefs) {
          addCOI({
            id: generateUUID(),
            subcontractorId: c.subId,
            projectId,
            fileUri: 'https://picsum.photos/seed/mage-coi/800/1000',
            uploadedAt: isoDaysAgo(30),
            validation: {
              validatedAt: isoDaysAgo(30),
              overallStatus: 'pass',
              issues: [],
              confidence: 96,
            },
            coverages: [
              { type: 'general_liability', carrierName: 'Travelers', eachOccurrence: 1_000_000, generalAggregate: 2_000_000, effectiveDate: dateDaysAgo(180), expiresAt: dateDaysAgo(-185) },
              { type: 'workers_comp', carrierName: 'Texas Mutual', eachOccurrence: 1_000_000, effectiveDate: dateDaysAgo(180), expiresAt: dateDaysAgo(-185) },
            ],
            notes: 'On file; verified against carrier.',
          });
        }
      } catch (err) { console.warn('[DevSeeder] COIs block failed:', err); }

      // 21. Client portal thread — 4 messages, alternating gc / homeowner.
      try {
        const thread: { authorType: PortalMessage['authorType']; authorName: string; body: string; agoDays: number }[] = [
          { authorType: 'gc', authorName: 'Westlake Builders', body: 'Steel is topped out and framing is moving fast — we\'re tracking right around 45% complete. Photos posted to your gallery.', agoDays: 9 },
          { authorType: 'client', authorName: 'Sofia Marchetti', body: 'It looks incredible! Quick question — can we still change the kitchen faucet selection or is that locked?', agoDays: 8 },
          { authorType: 'gc', authorName: 'Westlake Builders', body: 'Still open! I added a few curated options under Selections → Kitchen Faucet. Pick whenever you\'re ready; it\'s within allowance.', agoDays: 8 },
          { authorType: 'client', authorName: 'Daniel Marchetti', body: 'Perfect, we\'ll review tonight. Thanks for keeping the portal so up to date — makes this so much less stressful.', agoDays: 2 },
        ];
        for (const m of thread) {
          addPortalMessage({
            projectId,
            portalId,
            authorType: m.authorType,
            authorName: m.authorName,
            body: m.body,
            readByGc: m.authorType === 'gc' || m.agoDays > 3,
            readByClient: m.authorType === 'client' || m.agoDays > 3,
          });
        }
      } catch (err) { console.warn('[DevSeeder] portal thread block failed:', err); }

      // 22. Commitments — 2 signed subcontracts for job costing.
      try {
        const commitDefs: { number: string; vendor: string; subId?: string; desc: string; amount: number; phase: string; csi: string }[] = [
          { number: 'SC-01', vendor: 'Lone Star Steel Fab', subId: subSteelId, desc: 'Structural steel & timber package', amount: 192_500, phase: 'Structure', csi: '05' },
          { number: 'SC-02', vendor: 'Lone Star Mechanical', subId: subMepId, desc: 'HVAC + ERV mechanical package', amount: 88_400, phase: 'MEP', csi: '23' },
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
            signedDate: dateDaysAgo(48),
            phase: c.phase,
            csiDivision: c.csi,
            status: 'active',
            notes: '',
            createdAt: isoDaysAgo(48),
            updatedAt: isoNow,
          });
        }
      } catch (err) { console.warn('[DevSeeder] commitments block failed:', err); }

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt('Demo project loaded');
      router.replace({ pathname: '/project-detail' as any, params: { id: projectId } });
    } catch (err) {
      console.error('[DevSeeder] Failed to seed:', err);
      showAlert('Seed Failed', String(err));
    } finally {
      setSeeding(false);
    }
  }, [seeding, addProject, addInvoice, addDailyReport, addPunchItem, addProjectPhoto, addRFI, addChangeOrder, addPermit, savePermitRoadmap, addPlanSheet, savePlanReview, addPlanZone, addWarranty, addWarrantyClaim, addSubmittal, addAIAPayApp, addEquipment, addCOI, addPortalMessage, addCommitment, addSubcontractor, addContact, router]);

  const wipeAllProjects = useCallback(() => {
    showAlert(
      'Wipe ALL Projects?',
      `This will delete all ${projects.length} projects and their data. This is owner-only and intended for resetting demo state. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe All',
          style: 'destructive',
          onPress: () => {
            for (const p of projects) deleteProject(p.id);
            nailIt('All projects deleted');
          },
        },
      ],
    );
  }, [projects, deleteProject]);

  // Owner gate fires here — after all hooks have run for the render — so
  // we don't violate Rules of Hooks. Anyone but the platform owner gets
  // bounced to the home tab; the dev seeder UI never paints for them.
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
        <Text style={styles.headerTitle}>Dev — Demo Seeder</Text>
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
          <Text style={styles.cardTitle}>Load demo project</Text>
          <Text style={styles.cardSub}>
            Creates &ldquo;The Westlake Residence&rdquo; — a ~$1.4M, 4,200 sf luxury whole-home build, ~45% complete, with literally everything populated:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bullet}>• $1.4M estimate (trade line items) + schedule w/ baseline (EVM/variance)</Text>
            <Text style={styles.bullet}>• 5 invoices · 8 daily reports · 4 RFIs · 6 punch items · 1 change order</Text>
            <Text style={styles.bullet}>• 8 site photos · 1 with markup overlay</Text>
            <Text style={styles.bullet}>• Signed contract · 6 milestones · 5 selection categories (with photos)</Text>
            <Text style={styles.bullet}>• 4 permits + permit/inspection roadmap · plan sheet + code review + zones</Text>
            <Text style={styles.bullet}>• 2 warranties (+claim) · 3 submittals · AIA pay app · 2 equipment · 2 COIs</Text>
            <Text style={styles.bullet}>• 4 lien waivers · 2 commitments · 2 subs + 2 contacts · 4 portal messages</Text>
            <Text style={styles.bullet}>• Closeout binder DELIVERED · open-book mode · client portal pre-configured</Text>
          </View>
          <Text style={styles.cardSubFine}>
            Every screen will have something realistic to render. Drop into project-detail and every tile group lights up with status badges. Perfect for App Store screenshots.
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
                <Database size={16} color={themeColors.surface} strokeWidth={1.75} />
                <Text style={styles.ctaText}>Load demo project</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { marginTop: 16, borderColor: themeColors.danger + '40' }]}>
          <View style={[styles.cardIcon, { backgroundColor: themeColors.danger + '15' }]}>
            <Trash2 size={28} color={themeColors.danger} strokeWidth={1.75} />
          </View>
          <Text style={styles.cardTitle}>Wipe all projects</Text>
          <Text style={styles.cardSub}>
            Nukes every project on this account. Useful before recording a fresh screenshot run.
            Currently {projects.length} project{projects.length === 1 ? '' : 's'} on the account.
          </Text>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: themeColors.danger }]}
            onPress={wipeAllProjects}
            activeOpacity={0.85}
          >
            <Trash2 size={16} color={themeColors.surface} strokeWidth={1.75} />
            <Text style={styles.ctaText}>Wipe all projects</Text>
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
  headerTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
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
    backgroundColor: t.accent,
    paddingVertical: 14,
    borderRadius: Tokens.radius.card,
    marginTop: 8,
  },
  ctaText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.surface },
});
