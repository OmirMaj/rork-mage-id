// app/widget-setup.tsx — get your Instant Estimate widget.
//
// The embeddable widget shipped with no in-app way to obtain the snippet, which
// made it unadoptable: a contractor had no way to learn their own slug. This is
// that missing step — the exact copy-paste block, pre-filled with their slug.
//
// The widget ID is the contractor's account id (audit round 2, #10). It used to
// be slugify(companyName), resolved server-side by gc_user_for_company_slug —
// which routed every lead for two same-named companies to whichever account id
// sorted first, never matched an accented name, broke every live snippet on a
// rename, and for a GC with NO company name handed out "project": slugify('')'s
// fallback, which resolved to any stranger whose company name slugs to it. An
// account id is unique, immutable, and widget-estimate already accepts it.
// The company name is still required: it is the name the homeowner sees
// ("Sent to Summit Builders"), so without it we say so plainly rather than
// handing out a snippet that reads "Sent to Your Company".

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Linking } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, Copy, Check, ExternalLink, AlertTriangle, Code } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useCoreData } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { InfoBubble } from '@/components/InfoBubble';
import { showAlert } from '@/utils/alert';
import { buildEmbedSnippet, WIDGET_SLUG_PLACEHOLDER, WIDGET_NAME_PLACEHOLDER } from '@/utils/widgetEmbed';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const DOCS_URL = 'https://mageid.app/widget/';

export default function WidgetSetupScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();
  const { settings } = useCoreData();
  const [copied, setCopied] = useState(false);

  const { user } = useAuth();
  const companyName = settings?.branding?.companyName?.trim() ?? '';
  const widgetId = user?.id ?? '';
  // >>> widget-ready (scripts/validate-lead-contact-log.ts pins this)
  const ready = companyName.length > 0 && widgetId.length > 0;
  // <<< widget-ready
  const snippet = useMemo(
    () => buildEmbedSnippet(ready ? widgetId : WIDGET_SLUG_PLACEHOLDER, companyName || WIDGET_NAME_PLACEHOLDER),
    [widgetId, companyName, ready],
  );

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(snippet);
      setCopied(true);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showAlert('Could not copy', 'Select the code above and copy it manually.');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <Code size={15} color={t.accent} strokeWidth={2} />
          <Text style={styles.headerTitle} numberOfLines={1}>Estimate widget</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>On your own website</Text>
          <Text style={styles.heroTitle}>Let visitors price their job</Text>
          <Text style={styles.heroSub}>
            Paste one line into your site and homeowners get an instant ballpark — a published
            national range for the scope, not your prices. Every one that fills it in arrives here as
            a lead, with the range they were shown kept apart from any budget they give you.
          </Text>
          {/* The widget (supabase/functions/widget-estimate) reads none of his
              data: its range comes from a fixed table of published U.S. costs.
              This line used to say "priced from your numbers" (audit round 2,
              #24). Say it again only once the widget reads his own rates. */}
        </View>

        {!ready && (
          // Without a company name the widget would tell a homeowner their
          // details went to "Your Company". Say so instead of handing over a
          // snippet that reads wrong on their site.
          <View style={styles.warn}>
            <AlertTriangle size={15} color={Colors.warningLabel} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warnTitle}>Set your company name first</Text>
              <Text style={styles.warnText}>
                The widget shows homeowners your company name when their details are sent. Add it in
                Settings, then come back — the snippet below is a placeholder until then.
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/settings' as never)}
                accessibilityRole="button"
                accessibilityLabel="Open settings to set your company name"
              >
                <Text style={styles.warnLink}>Open Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardLabel}>Your embed code</Text>
            <InfoBubble
              title="How the widget works"
              what="A single script tag renders a small estimate form on your own website. A visitor answers a few questions and sees a price range immediately."
              why="Most visitors leave without calling. This captures the ones who wanted a number, and sends them to you as a lead with their project details already filled in."
            />
          </View>
          <View style={styles.codeBox}>
            <Text style={styles.code} selectable>{snippet}</Text>
          </View>
          <TouchableOpacity
            style={[styles.copyBtn, copied && styles.copyBtnDone]}
            onPress={() => void copy()}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Copy the embed code"
            testID="widget-copy"
          >
            {copied ? (
              <Check size={15} color={t.success} strokeWidth={2.5} />
            ) : (
              <Copy size={15} color={Colors.textOnAccent} strokeWidth={2.25} />
            )}
            <Text style={[styles.copyText, copied && { color: t.success }]}>
              {copied ? 'Copied' : 'Copy embed code'}
            </Text>
          </TouchableOpacity>
          {ready && (
            <Text style={styles.slugNote}>
              Your widget ID is <Text style={styles.slugMono}>{widgetId}</Text>. It never changes, so
              renaming your company won&apos;t break the widget. A snippet copied before this used your
              company name — paste this one over it.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Where to paste it</Text>
          <Text style={styles.step}>1 · Open your website editor (Squarespace, Wix, WordPress…).</Text>
          <Text style={styles.step}>2 · Find the page where people ask for a quote.</Text>
          <Text style={styles.step}>3 · Add an embed / custom-HTML block and paste the code.</Text>
          <Text style={styles.step}>4 · Publish. The form appears where you pasted it.</Text>
          <TouchableOpacity
            style={styles.docsRow}
            onPress={() => void Linking.openURL(DOCS_URL)}
            accessibilityRole="link"
            accessibilityLabel="Open the widget documentation and live demo"
          >
            <ExternalLink size={13} color={t.accent} strokeWidth={2} />
            <Text style={styles.docsText}>See a live demo and full setup guide</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    headerTitle: { ...Type.serifHeadline, color: t.text },
    scroll: { padding: Tokens.spacing.md, paddingBottom: 40 },
    scrollDesktop: { width: '100%', maxWidth: 900, alignSelf: 'center', paddingHorizontal: 24 },
    hero: { marginBottom: Tokens.spacing.lg },
    eyebrow: {
      ...Type.caption1,
      color: t.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: 2,
    },
    heroTitle: { ...Type.title2, color: t.text },
    heroSub: { ...Type.subhead, color: t.textSecondary, marginTop: 4, lineHeight: 21 },
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.md,
    },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    cardLabel: { ...Type.subheadEmphasized, color: t.text, marginBottom: Tokens.spacing.sm },
    codeBox: {
      backgroundColor: t.surfaceAlt,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.md,
      padding: Tokens.spacing.sm,
    },
    code: {
      ...Type.monoCaption,
      color: t.text,
    },
    copyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      marginTop: Tokens.spacing.sm,
      paddingVertical: 12,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.accentFill,
    },
    copyBtnDone: { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line },
    copyText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    slugNote: { ...Type.caption1, color: t.textMuted, marginTop: Tokens.spacing.sm },
    slugMono: { ...Type.monoCaption, color: t.textSecondary },
    step: { ...Type.footnote, color: t.textSecondary, marginBottom: 6, lineHeight: 19 },
    docsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Tokens.spacing.sm },
    docsText: { ...Type.footnote, color: t.accent, fontWeight: '600' },
    warn: {
      flexDirection: 'row',
      gap: Tokens.spacing.sm,
      backgroundColor: Colors.warning + '12',
      borderWidth: 1,
      borderColor: Colors.warning + '40',
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      marginBottom: Tokens.spacing.md,
    },
    warnTitle: { ...Type.footnoteEmphasized, color: t.text },
    warnText: { ...Type.caption1, color: t.textSecondary, marginTop: 3, lineHeight: 17 },
    warnLink: { ...Type.caption1, color: t.accent, fontWeight: '700', marginTop: 6 },
  });
