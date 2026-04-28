// app/dev-seeder.tsx — Owner-only demo data seeder.
//
// Press "Load demo project" and the screen seeds a realistic-looking
// construction project (estimates, photos, RFIs, invoices, daily
// reports, punch items, change orders) so App Store screenshots and
// internal demos don't have to start from a blank state.
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
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter, Redirect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Sparkles, Database, Trash2, AlertTriangle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { isOwner } from '@/utils/owner';
import { generateUUID } from '@/utils/generateId';
import { nailIt } from '@/components/animations/NailItToast';
import type { Project, Invoice, DailyFieldReport, PunchItem, ProjectPhoto, ChangeOrder, PhotoMarkup } from '@/types';
// Wave 1-5 engines — seeded so screenshots show every feature loaded
// with realistic-looking data instead of empty states.
import { saveContract } from '@/utils/contractEngine';
import { saveSelectionCategory, saveCuratedOptions, chooseSelectionOption, fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { saveLienWaiver } from '@/utils/lienWaiverEngine';
import { saveCloseoutBinder, DEFAULT_MAINTENANCE } from '@/utils/closeoutBinderEngine';

export default function DevSeederScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    projects, addProject, deleteProject,
    addInvoice, addDailyReport, addPunchItem,
    addProjectPhoto, addRFI, addChangeOrder,
  } = useProjects();

  const [seeding, setSeeding] = useState<boolean>(false);

  // Owner gate: anyone other than the platform owner gets bounced.
  // Done via Redirect (declarative) so refreshing the page doesn't
  // briefly flash this screen before the check runs.
  if (!isOwner(user?.email)) {
    return <Redirect href="/(tabs)/(home)" />;
  }

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

      // 1. The project itself — a 3,200 sf full-gut renovation in Brooklyn.
      // High-end finishes, mid-build, decent activity across all surfaces.
      const project = {
        id: projectId,
        name: 'The Henderson Residence',
        type: 'renovation',
        location: '124 Park Slope, Brooklyn NY 11215',
        squareFootage: 3200,
        quality: 'premium',
        description: 'Full-gut renovation of a 3-story brownstone. New mechanicals, custom millwork throughout, designer kitchen + 4 baths.',
        createdAt: isoDaysAgo(45),
        updatedAt: isoNow,
        estimate: {
          materialTotal: 184_500,
          laborTotal: 142_000,
          permits: 8_500,
          overhead: 33_500,
          contingency: 18_400,
          taxAmount: 32_660,
          totalCost: 419_560,
          markupPercent: 22,
          markupAmount: 92_303,
          grandTotal: 511_863,
          pricePerSqFt: 159.96,
          estimatedDuration: '5-6 months',
          bulkSavingsTotal: 14_780,
          materials: [],
        },
        status: 'in_progress',
        // Open-book contract mode so the portal shows the real cost
        // breakdown — useful for the "Open Book / GMP" screenshot.
        contractMode: 'open_book',
        // Pre-populated client portal: homeowner invited, all sections
        // toggled on, language set to Spanish so screenshots can show
        // the multi-language portal in action.
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
          welcomeMessage: 'Welcome! This is your live project portal. Let me know if anything looks off.',
          coApprovalEnabled: true,
          clientCanSetBudget: false,
          homeownerLanguage: 'en',
          invites: [
            {
              id: generateUUID(),
              email: 'lhenderson@example.com',
              name: 'Linda Henderson',
              createdAt: isoDaysAgo(40),
              viewedAt: isoDaysAgo(2),
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
      const invoiceData: Array<Pick<Invoice, 'number' | 'type' | 'progressPercent' | 'issueDate' | 'dueDate' | 'totalDue' | 'amountPaid' | 'status'>> = [
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
        title: 'Cooper-Henderson Renovation Agreement',
        contractValue: 511_863,
        scopeText:
          'Full-gut renovation of three-story brownstone. New mechanicals, custom millwork, designer kitchen, four bathrooms.',
        termsText: 'Standard residential contract terms. Payment per milestone schedule below. Either party may terminate for material breach with 30 days notice.',
        warrantyText: 'Twelve-month workmanship warranty from date of substantial completion. Manufacturer warranties pass through to homeowner where applicable.',
        startDate: isoDaysAgo(45),
        durationDays: 165,
        paymentSchedule: [
          { id: generateUUID(), label: 'Deposit', trigger: 'on_signing', amount: 76_780, percent: 15, status: 'paid', paidAt: isoDaysAgo(38) },
          { id: generateUUID(), label: 'Foundation pour complete', trigger: 'on_milestone', amount: 76_780, percent: 15, status: 'paid', paidAt: isoDaysAgo(28) },
          { id: generateUUID(), label: 'Framing complete', trigger: 'on_milestone', amount: 102_372, percent: 20, status: 'invoiced', invoicedAt: isoDaysAgo(14) },
          { id: generateUUID(), label: 'Mechanicals + drywall complete', trigger: 'on_milestone', amount: 102_372, percent: 20, status: 'pending' },
          { id: generateUUID(), label: 'Substantial completion', trigger: 'on_milestone', amount: 102_372, percent: 20, status: 'pending' },
          { id: generateUUID(), label: 'Final + punch list', trigger: 'on_final', amount: 51_187, percent: 10, status: 'pending' },
        ],
        // Allowances — these will auto-create matching SelectionCategory
        // rows when the contract is "sent," but here we seed them
        // explicitly below for screenshot purposes.
        allowances: [
          { id: generateUUID(), category: 'Kitchen Tile', amount: 8_500, description: 'Backsplash + island surround' },
          { id: generateUUID(), category: 'Bathroom Tile', amount: 12_000, description: 'Primary + 2 hall baths' },
          { id: generateUUID(), category: 'Lighting Fixtures', amount: 6_500, description: 'Whole house, owner-selected' },
          { id: generateUUID(), category: 'Plumbing Fixtures', amount: 9_800, description: 'Faucets, sinks, toilets' },
          { id: generateUUID(), category: 'Hardwood Flooring', amount: 14_200, description: 'Living + dining + bedrooms' },
        ],
        gcSignature: { name: 'Marcus Henderson', role: 'gc', signedAt: isoDaysAgo(40) },
        homeownerSignature: { name: 'Linda Henderson', role: 'homeowner', signedAt: isoDaysAgo(38) },
        signedAt: isoDaysAgo(38),
        status: 'signed',
      });

      // 9. Selection Categories — five, with chosen options spanning
      //    budget / on-target / premium tiers. ONE category is over
      //    allowance to demonstrate the "Draft Change Order" CTA.
      const selSeeds = [
        {
          name: 'Kitchen Tile', budget: 8500, brief: 'Modern, light, easy to clean',
          options: [
            { product: 'White subway 3x6', brand: 'American Olean', total: 6_400, isChosen: false },
            { product: 'Calacatta 12x24 porcelain', brand: 'Ann Sacks', total: 8_300, isChosen: true },  // on-target chosen
            { product: 'Hand-cut Moroccan zellige', brand: 'Cle Tile', total: 14_900, isChosen: false },
          ],
        },
        {
          name: 'Bathroom Tile', budget: 12000, brief: 'Spa feel, marble or marble-look',
          options: [
            { product: 'Carrara honed 12x24', brand: 'Daltile', total: 9_200, isChosen: false },
            { product: 'Statuario polished hex', brand: 'Ann Sacks', total: 11_800, isChosen: false },
            { product: 'Calacatta gold herringbone', brand: 'Walker Zanger', total: 16_400, isChosen: true }, // OVER allowance — triggers CO CTA
          ],
        },
        {
          name: 'Lighting Fixtures', budget: 6500, brief: 'Warm, dimmable, mid-century',
          options: [
            { product: 'Schoolhouse + Rejuvenation mix', brand: 'Schoolhouse', total: 4_800, isChosen: true },  // budget chosen
            { product: 'Hudson Valley brass family', brand: 'Hudson Valley', total: 6_700, isChosen: false },
            { product: 'Apparatus + Roll & Hill', brand: 'Apparatus', total: 11_400, isChosen: false },
          ],
        },
        {
          name: 'Plumbing Fixtures', budget: 9800, brief: 'Polished nickel, classic',
          options: [
            { product: 'Kohler Artifacts complete', brand: 'Kohler', total: 8_400, isChosen: false },
            { product: 'Waterworks Henry collection', brand: 'Waterworks', total: 9_700, isChosen: true },  // on-target
            { product: 'Lefroy Brooks heritage', brand: 'Lefroy Brooks', total: 14_200, isChosen: false },
          ],
        },
        {
          name: 'Hardwood Flooring', budget: 14200, brief: 'White oak, wide plank, matte finish',
          options: [
            { product: '4-inch white oak Natural', brand: 'Carlisle', total: 11_800, isChosen: false },
            { product: '7-inch white oak Pickled', brand: 'Carlisle', total: 13_900, isChosen: false },
            { product: '8-inch rift+quartered Custom', brand: 'Carlisle', total: 17_600, isChosen: false },  // none chosen — pending pick
          ],
        },
      ];

      const selectionsPromise = (async () => {
        // 1) Save each category + its options.
        for (const s of selSeeds) {
          const cat = await saveSelectionCategory({
            projectId,
            category: s.name,
            budget: s.budget,
            styleBrief: s.brief,
          });
          if (!cat) continue;
          const options = s.options.map(o => ({
            categoryId: cat.id,
            productName: o.product,
            brand: o.brand,
            description: '',
            unitPrice: o.total,
            unit: 'lump',
            quantity: 1,
            total: o.total,
            highlights: [],
            isChosen: false,
          }));
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
          'Linda + Marcus — thanks for trusting us with the brownstone. Everything you need to maintain the place is in here. Call any time, especially in the first year while warranties are live.\n\n— The Henderson Build team',
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

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      nailIt('Demo project loaded');
      router.replace({ pathname: '/project-detail' as any, params: { id: projectId } });
    } catch (err) {
      console.error('[DevSeeder] Failed to seed:', err);
      Alert.alert('Seed Failed', String(err));
    } finally {
      setSeeding(false);
    }
  }, [seeding, addProject, addInvoice, addDailyReport, addPunchItem, addProjectPhoto, addRFI, addChangeOrder, router]);

  const wipeAllProjects = useCallback(() => {
    Alert.alert(
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <ChevronLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Dev — Demo Seeder</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }}>
        <View style={styles.warningCard}>
          <AlertTriangle size={18} color={Colors.warning} />
          <Text style={styles.warningText}>
            Owner-only screen. Only emails in OWNER_EMAILS (utils/owner.ts) reach here.
            Regular users get redirected home.
          </Text>
        </View>

        <View style={styles.card}>
          <View style={[styles.cardIcon, { backgroundColor: Colors.primary + '15' }]}>
            <Sparkles size={28} color={Colors.primary} />
          </View>
          <Text style={styles.cardTitle}>Load demo project</Text>
          <Text style={styles.cardSub}>
            Creates &ldquo;The Henderson Residence&rdquo; — a 3,200 sf brownstone renovation with everything populated:
          </Text>
          <View style={styles.bulletList}>
            <Text style={styles.bullet}>• Estimate ($511K) + 5 invoices (mixed paid/partial/sent)</Text>
            <Text style={styles.bullet}>• 8 daily field reports + AI homeowner summary published</Text>
            <Text style={styles.bullet}>• 4 RFIs · 6 punch items · 1 approved change order</Text>
            <Text style={styles.bullet}>• 8 site photos · 1 with markup overlay</Text>
            <Text style={styles.bullet}>• Signed contract · 6 payment milestones · 5 allowances</Text>
            <Text style={styles.bullet}>• 5 selection categories with chosen options (1 over allowance)</Text>
            <Text style={styles.bullet}>• 4 lien waivers (received / signed / requested)</Text>
            <Text style={styles.bullet}>• Closeout binder DELIVERED · custom note · maintenance schedule</Text>
            <Text style={styles.bullet}>• Open-book / GMP mode · client portal pre-configured</Text>
          </View>
          <Text style={styles.cardSubFine}>
            Every screen will have something realistic to render. Drop into project-detail and the Money tile group lights up with status badges. Perfect for App Store screenshots.
          </Text>
          <TouchableOpacity
            style={[styles.cta, seeding && { opacity: 0.6 }]}
            onPress={seed}
            disabled={seeding}
            activeOpacity={0.85}
          >
            {seeding ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Database size={16} color="#FFFFFF" />
                <Text style={styles.ctaText}>Load demo project</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { marginTop: 16, borderColor: Colors.error + '40' }]}>
          <View style={[styles.cardIcon, { backgroundColor: Colors.error + '15' }]}>
            <Trash2 size={28} color={Colors.error} />
          </View>
          <Text style={styles.cardTitle}>Wipe all projects</Text>
          <Text style={styles.cardSub}>
            Nukes every project on this account. Useful before recording a fresh screenshot run.
            Currently {projects.length} project{projects.length === 1 ? '' : 's'} on the account.
          </Text>
          <TouchableOpacity
            style={[styles.cta, { backgroundColor: Colors.error }]}
            onPress={wipeAllProjects}
            activeOpacity={0.85}
          >
            <Trash2 size={16} color="#FFFFFF" />
            <Text style={styles.ctaText}>Wipe all projects</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  warningCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    backgroundColor: Colors.warning + '12',
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.warning + '30',
  },
  warningText: { flex: 1, fontSize: 12, color: Colors.text, lineHeight: 17 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 22,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  cardIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  cardTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.4 },
  cardSub: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  cardSubFine: { fontSize: 12, color: Colors.textMuted, lineHeight: 17, marginTop: 6, fontStyle: 'italic' as const },
  bulletList: { gap: 4, marginTop: 8, marginBottom: 8 },
  bullet: { fontSize: 12, color: Colors.text, lineHeight: 17 },
  cta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '700' as const, color: '#FFFFFF' },
});
