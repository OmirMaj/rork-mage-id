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
import type { Project, Invoice, DailyFieldReport, PunchItem, ProjectPhoto, ChangeOrder } from '@/types';

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
      dfrTopics.forEach((d, i) => {
        const date = isoDaysAgo(i * 2 + 1);
        const tempStr = d.weather.match(/([0-9]+)°/);
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
      photoTags.forEach((tag, i) => {
        addProjectPhoto({
          id: generateUUID(),
          projectId,
          uri: `https://picsum.photos/seed/mage-demo-${i}/640/480`,
          timestamp: isoDaysAgo(30 - i * 3),
          location: photoLocations[i],
          tag,
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
            Creates "The Henderson Residence" — a 3,200 sf brownstone renovation with realistic
            estimates, 5 invoices (mixed paid/partial/sent), 8 daily field reports across 2 weeks,
            4 RFIs, 6 punch items, 8 photos with GPS, and 1 approved change order. Perfect for
            App Store screenshots and demos.
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
