// ship-readiness.tsx — internal "what's left before we ship?" board.
//
// Built for the 2-week ship horizon. Lists:
//   - Workflow surfaces shipped this sprint (✓ done)
//   - External setup the GC owner needs to do (⚠ user action)
//   - Pending cutovers in the codebase (🔄)
//   - Pre-flight checks to run before TestFlight upload (☐)
//
// Some items are auto-detected from app state (project count,
// migrations applied) — most are static reminders that survive
// across sessions so the user has one place to track launch.
//
// Hidden from end users: the route exists in _layout but no nav
// link surfaces it. Open via the deep link `rork-app://ship-readiness`
// or by typing the path into the Expo dev menu.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CheckCircle2, AlertTriangle, Clock, Circle, ExternalLink,
  Rocket,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useDeliveryReceipts } from '@/hooks/useDeliveryReceipts';
import { useDrawPeriods } from '@/hooks/useDrawPeriods';
import { useOwnerSuppliedItems } from '@/hooks/useOwnerSuppliedItems';
import { useSubChangeRequests } from '@/hooks/useSubChangeRequests';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type ItemStatus = 'done' | 'pending' | 'blocked' | 'check';

interface ChecklistItem {
  id: string;
  title: string;
  body: string;
  status: ItemStatus;
  /** External link, when this item drives the user out to set
   *  up something (Intuit dev portal, Google Cloud Console). */
  href?: string;
}

interface ChecklistGroup {
  id: string;
  title: string;
  desc: string;
  items: ChecklistItem[];
}

function statusTint(status: ItemStatus): string {
  switch (status) {
    case 'done': return Colors.success;
    case 'pending': return Colors.warning;
    case 'blocked': return Colors.error;
    case 'check': return Colors.info;
  }
}

function StatusIcon({ status }: { status: ItemStatus }) {
  const props = { size: 16, color: statusTint(status) };
  if (status === 'done') return <CheckCircle2 {...props} />;
  if (status === 'pending') return <AlertTriangle {...props} />;
  if (status === 'blocked') return <AlertTriangle {...props} />;
  return <Circle {...props} />;
}

export default function ShipReadinessScreen() {
  const insets = useSafeAreaInsets();
  const { projects } = useProjects();
  const { receipts } = useDeliveryReceipts();
  const { draws } = useDrawPeriods();
  const { items: owners } = useOwnerSuppliedItems();
  const { requests } = useSubChangeRequests();

  // Auto-detect a few items from current app state. The rest are
  // static reminders that don't have a clean signal in code.
  const groups = useMemo<ChecklistGroup[]>(() => [
    {
      id: 'workflow',
      title: 'Workflow surfaces shipped',
      desc: 'Cross-project decision-loop docks built this sprint. All wired to summary tab Tools.',
      items: [
        {
          id: 'approvals',
          title: 'Approvals dock',
          body: 'Cross-project change orders + RFIs + bid awards with inline approve/reject.',
          status: 'done',
        },
        {
          id: 'oac',
          title: 'OAC action item dock',
          body: 'Open action items aggregated across every meeting on every project. Mark-done in place.',
          status: 'done',
        },
        {
          id: 'sub-cr',
          title: 'Sub change request inbox',
          body: `${requests.length} sub-initiated request${requests.length === 1 ? '' : 's'} on file. Approve / revise / reject inline.`,
          status: 'done',
        },
        {
          id: 'deliveries',
          title: 'Delivery receipt log',
          body: `${receipts.length} delivery receipt${receipts.length === 1 ? '' : 's'} on file. BOL photo + damage flag + supplier credit follow-up.`,
          status: 'done',
        },
        {
          id: 'draws',
          title: 'Draw period dashboard',
          body: `${draws.length} draw period${draws.length === 1 ? '' : 's'} tracked. Lender-facing rollup with status pivot.`,
          status: 'done',
        },
        {
          id: 'ofci',
          title: 'OFCI / OFOI tracker',
          body: `${owners.length} owner-supplied item${owners.length === 1 ? '' : 's'} tracked. At-risk filter for items needed within 7 days.`,
          status: 'done',
        },
      ],
    },
    {
      id: 'perf',
      title: 'Performance + reliability',
      desc: 'Lower-risk perf wins shipped alongside the workflow surfaces.',
      items: [
        {
          id: 'expo-image',
          title: 'expo-image on photo-heavy screens',
          body: 'Migrated photo-triage, ai-punch, project-detail, sub-change-requests, delivery-receipts, punch-walk, coi-vault. Disk-cached thumbnails reduce memory ceiling on older iPhones.',
          status: 'done',
        },
        {
          id: 'offline-queue',
          title: 'Offline-first writes',
          body: 'Every new hook (useDeliveryReceipts / useDrawPeriods / useOwnerSuppliedItems / useSubChangeRequests) routes through supabaseWrite. Optimistic local + queued server. Survives airplane mode.',
          status: 'done',
        },
      ],
    },
    {
      id: 'security',
      title: 'Security cutovers',
      desc: 'Items shipped behind a flag, awaiting external readiness.',
      items: [
        {
          id: 'portal-rls',
          title: 'Lock down portal_snapshots RLS',
          body: 'Migration ready in supabase/migrations/_pending/drop_portal_snapshots_anon_read.sql. Apply AFTER updating the external portal HTML to use the get_portal_snapshot() RPC. Until then, anon SELECT is intentionally still allowed so existing portal links keep working.',
          status: 'pending',
        },
      ],
    },
    {
      id: 'external',
      title: 'External setup (user action)',
      desc: 'These don\'t block ship — features degrade gracefully if missing — but each unlocks a paid tier feature.',
      items: [
        {
          id: 'intuit',
          title: 'Intuit (QuickBooks Online) dev account',
          body: 'Create app at developer.intuit.com → My Apps. Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_ENVIRONMENT, APP_DEEP_LINK_URL on the qbo-oauth-* edge function secrets.',
          status: 'pending',
          href: 'https://developer.intuit.com/app/developer/myapps',
        },
        {
          id: 'google-maps',
          title: 'Google Maps Android API key',
          body: 'app.json line 38 has placeholder REPLACE_WITH_GOOGLE_MAPS_ANDROID_API_KEY. Create a key at console.cloud.google.com (Maps SDK for Android), restrict by package name + SHA-1, paste into app.json. iOS uses Apple Maps (free) — no setup needed.',
          status: 'pending',
          href: 'https://console.cloud.google.com/google/maps-apis/start',
        },
        {
          id: 'revenuecat',
          title: 'RevenueCat product configuration',
          body: 'Verify RC dashboard has products: com.mageid.pro.monthly, .pro.annual, .business.monthly, .business.annual, .enterprise.monthly, .enterprise.annual. Offering packages: pro_monthly, pro_annual, business_monthly, business_annual, enterprise_monthly, enterprise_annual. Entitlements: pro, business, enterprise.',
          status: 'pending',
          href: 'https://app.revenuecat.com',
        },
        {
          id: 'apple-app-store',
          title: 'App Store Connect metadata',
          body: 'ascAppId 6762229238, team HKT2J284D2. Confirm: privacy policy URL, support URL, screenshots (6.7", 5.5"), description, keywords, age rating. Set up in-app purchase products to mirror RevenueCat.',
          status: 'pending',
          href: 'https://appstoreconnect.apple.com',
        },
        {
          id: 'supabase-functions',
          title: 'Edge function deployments',
          body: 'Deploy via `supabase functions deploy <name>`: qbo-oauth-start, qbo-oauth-callback, qbo-disconnect, ics-feed, extract-plan-metadata. Verify env vars set on each.',
          status: 'pending',
        },
      ],
    },
    {
      id: 'preflight',
      title: 'Pre-flight checks',
      desc: 'Run these in this order before each TestFlight upload.',
      items: [
        {
          id: 'tsc',
          title: '`npx tsc --noEmit`',
          body: 'Zero errors. Strict mode is on; do not ship with red squiggles.',
          status: 'check',
        },
        {
          id: 'lint',
          title: '`bun run lint`',
          body: 'Expo lint (eslint flat config). Fix anything new — leftover warnings make real ones harder to spot.',
          status: 'check',
        },
        {
          id: 'manual-smoke',
          title: 'iOS smoke test on TestFlight build',
          body: 'Walk: sign up → create project → daily report → photo capture → mark punch → approve a CO → portal share. The 6 critical paths every onboarded user touches in week one.',
          status: 'check',
        },
        {
          id: 'eas-channel',
          title: 'EAS update channel sanity',
          body: 'eas.json must set channel: "production" / "preview" on the build profile. OTA published to "production" only reaches devices built on that profile. Don\'t cross channels.',
          status: 'check',
        },
        {
          id: 'runtime-version',
          title: 'Runtime version is appVersion',
          body: 'app.json runtimeVersion.policy = "appVersion". Bumping expo.version forces a new native build (OTA won\'t cross). Keep version stable when shipping JS-only fixes.',
          status: 'check',
        },
        {
          id: 'master-emails',
          title: 'OWNER_EMAILS / MASTER_EMAILS in sync',
          body: 'utils/owner.ts (client) and supabase/functions/_shared/auth.ts (server) must match. Asymmetry creates "I\'m admin server-side but UI shows me free" debugging hell.',
          status: 'check',
        },
        {
          id: 'data-sanity',
          title: `Data sanity: ${projects.length} project${projects.length === 1 ? '' : 's'} on file`,
          body: projects.length === 0
            ? 'Empty database — kick off your test project before recording the App Store screenshots.'
            : 'You have data — every screenshot can be taken from a real project rather than placeholder copy.',
          status: projects.length === 0 ? 'pending' : 'done',
        },
      ],
    },
  ], [projects.length, receipts.length, draws.length, owners.length, requests.length]);

  const totals = useMemo(() => {
    const all = groups.flatMap(g => g.items);
    return {
      done: all.filter(i => i.status === 'done').length,
      pending: all.filter(i => i.status === 'pending').length,
      blocked: all.filter(i => i.status === 'blocked').length,
      check: all.filter(i => i.status === 'check').length,
      total: all.length,
    };
  }, [groups]);

  const openHref = (href: string) => {
    void Linking.openURL(href).catch(err => {
      console.warn('[ship-readiness] failed to open', href, err);
    });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Ship readiness',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: Tokens.spacing.sm, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Rocket size={22} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>2-Week launch board</Text>
          <Text style={styles.heroBody}>
            What&apos;s done, what needs your action, what to verify before TestFlight.
          </Text>
          <View style={styles.heroStats}>
            <HeroStat label="Done" value={totals.done} tint={Colors.success} />
            <HeroStat label="To set up" value={totals.pending} tint={Colors.warning} />
            <HeroStat label="To verify" value={totals.check} tint={Colors.info} />
          </View>
        </View>

        {groups.map(group => (
          <View key={group.id} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title}</Text>
            <Text style={styles.groupDesc}>{group.desc}</Text>
            <View style={styles.groupCard}>
              {group.items.map((item, idx) => {
                const tint = statusTint(item.status);
                const Wrapper = item.href ? TouchableOpacity : View;
                const wrapperProps = item.href
                  ? {
                      onPress: () => openHref(item.href!),
                      activeOpacity: 0.85,
                      accessibilityRole: 'button' as const,
                    }
                  : {};
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.itemRow,
                      idx < group.items.length - 1 && styles.itemRowBorder,
                    ]}
                  >
                    <View style={[styles.itemIconWrap, { backgroundColor: tint + '15' }]}>
                      <StatusIcon status={item.status} />
                    </View>
                    <Wrapper style={{ flex: 1 }} {...wrapperProps}>
                      <View style={styles.itemTitleRow}>
                        <Text style={styles.itemTitle}>{item.title}</Text>
                        {item.href && <ExternalLink size={12} color={Colors.textMuted} />}
                      </View>
                      <Text style={styles.itemBody}>{item.body}</Text>
                    </Wrapper>
                    {item.status === 'done' && (
                      <View style={styles.doneBadge}>
                        <Text style={styles.doneBadgeText}>OK</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footer}>
          <Clock size={11} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Hidden from end users — open via deep link rork-app://ship-readiness or by adding /ship-readiness to the URL.
            Auto-counts pull from your live data, so this board reflects real state every time you open it.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function HeroStat({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={[styles.heroStatValue, { color: tint }]}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: Tokens.spacing.md,
    marginBottom: Tokens.spacing.md,
    padding: Tokens.spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 10,
  },
  heroTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  heroBody: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.xxs,
    lineHeight: 18,
  },
  heroStats: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.md,
    marginTop: 14,
  },
  heroStat: { flex: 1, alignItems: 'flex-start' as const },
  heroStatValue: {
    fontSize: Type.title1.fontSize,
    fontWeight: '900' as const,
    letterSpacing: -0.6,
  },
  heroStatLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
    marginTop: Tokens.spacing.hairline,
  },

  group: { marginBottom: 22 },
  groupTitle: {
    paddingHorizontal: Tokens.spacing.md,
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  groupDesc: {
    paddingHorizontal: Tokens.spacing.md,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: Tokens.spacing.xs,
    marginTop: Tokens.spacing.hairline,
    lineHeight: 17,
  },
  groupCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: Tokens.spacing.md,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },

  itemRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: Tokens.spacing.sm,
  },
  itemRowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  itemIconWrap: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
  },
  itemTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  itemTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.1,
  },
  itemBody: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: 17,
  },

  doneBadge: {
    paddingHorizontal: Tokens.spacing.xs,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.success + '15',
    alignSelf: 'flex-start' as const,
    marginTop: 1,
  },
  doneBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.success,
    letterSpacing: 0.4,
  },

  footer: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: Tokens.spacing.md,
    opacity: 0.7,
  },
  footerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});

