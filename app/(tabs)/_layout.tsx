import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Tabs, Slot } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Settings } from 'lucide-react-native';
import { MageProject, MageDiscover, MageSummary } from '@/components/icons';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import DesktopActionRail from '@/components/DesktopActionRail';
import { useBrainWatch } from '@/hooks/useBrainWatch';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/**
 * TabIcon — wraps a tab icon with a focused-state indicator dot
 * underneath. The dot fades + scales in when the tab becomes active,
 * giving every tab a subtle "you are here" cue beyond just color
 * change. Premium-app polish without any extra layout math.
 */
function TabIcon({
  Icon, color, focused,
}: { Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>; color: string; focused: boolean }) {
  // Two animated values now: a pill that fades behind the icon when
  // active, and a tiny scale bounce on transition. Together they make
  // the active state feel premium ("pill morphs in") instead of just
  // a color change.
  const focus = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const bounce = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(focus, {
      toValue: focused ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (focused) {
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1.08, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(bounce, { toValue: 1, speed: 40, bounciness: 6, useNativeDriver: true }),
      ]).start();
    }
  }, [focused, focus, bounce]);
  return (
    <View style={tabIconStyles.wrap}>
      <Animated.View
        style={[
          tabIconStyles.pill,
          {
            backgroundColor: color + '1A', // 10% tint of the active color
            opacity: focus,
            transform: [{ scale: focus.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          },
        ]}
      />
      <Animated.View style={{ transform: [{ scale: bounce }] }}>
        <Icon size={23} color={color} strokeWidth={focused ? 2.4 : 1.8} />
      </Animated.View>
      <Animated.View
        style={[
          tabIconStyles.dot,
          { backgroundColor: color, opacity: focus, transform: [{ scale: focus }] },
        ]}
      />
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 3,
    position: 'relative' as const,
    minHeight: 36,
  },
  // The faint pill behind the icon — gives the active tab clear weight
  // beyond just color change. Sits behind the icon (zIndex via order).
  pill: {
    position: 'absolute' as const,
    width: 56,
    height: 32,
    borderRadius: Tokens.radius.panel,
    top: -4,
  },
  dot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 2 },
});

export default function TabLayout() {
  const layout = useResponsiveLayout();
  const { total: attentionCount } = useBrainWatch();
  const { colors: themeColors } = useTheme();
  const { userRole } = useCoreData();
  // Non-contractor personas get a stripped-down tab bar. The original
  // product surface (Summary, Discover with public-bid search + supplier
  // marketplace) is contractor-shaped — a property owner posting renovations,
  // or a property manager running a maintenance portfolio, does not want to
  // see "MAGE ID Bids" or "Companies" or a financial summary. We collapse to
  // two tabs: Home (the persona's hub — ClientHome or PropertyManagerHome) +
  // Settings. 'both' falls through to the full contractor tab bar by design.
  const isMinimalPersona = userRole === 'client' || userRole === 'property_manager';
  // Tab badge = THE canonical needs-attention count (useBrainWatch) — the
  // same number the Brain Watch card and the Summary hero pill show. It
  // used to be the Smart Inbox row count, so the badge said "11" while
  // Summary said "1" and the Brain Watch card said "5" (sim-audit #15).
  // The Inbox card carries its own count under its own scoped "Inbox" label.
  const attentionBadge = attentionCount > 0
    ? (attentionCount > 99 ? '99+' : String(attentionCount))
    : undefined;

  // Right-rail "Action Required" column shows on wide desktops (>= 1280px
  // viewport). Below that we don't have horizontal room for a clean three-
  // column layout — the inline SmartInbox in the home tab takes over.
  const showActionRail = layout.isDesktop && layout.width >= 1280;

  if (layout.showSidebar) {
    return (
      <View style={styles.desktopContainer}>
        {/* DesktopSidebar mounts ONCE at the root layout (app/_layout.tsx
            RootLayoutNav) so it persists across stack routes too — audit
            web#31. This layout only hides the tab bar on desktop and adds
            the Action-Required rail on wide viewports. */}
        <View style={styles.desktopContent}>
          <Tabs
            initialRouteName="(home)"
            screenOptions={{
              headerShown: false,
              tabBarStyle: { display: 'none' },
            }}
          >
            {/* Client persona hides the contractor-only top-level tabs.
                The DesktopSidebar (filtered separately by role) still gives
                clients reachable nav for /my-rfps, /post-rfp, Settings.
                Using `href: null` rather than conditional render so the
                Tabs router keeps a stable screen registry across persona
                switches (avoids "tab not found" routing flicker). */}
            <Tabs.Screen name="summary" options={isMinimalPersona ? { href: null } : { title: 'Summary' }} />
            <Tabs.Screen name="(home)" options={{ title: isMinimalPersona ? 'Home' : 'Your Projects' }} />
            <Tabs.Screen name="discover" options={isMinimalPersona ? { href: null } : { title: 'Discover' }} />
            <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
            <Tabs.Screen name="mage-id-bids" options={isMinimalPersona ? { href: null } : { title: 'MAGE ID Bids' }} />
            <Tabs.Screen name="construction-ai" options={{ href: null }} />
            <Tabs.Screen name="estimate" options={{ href: null }} />
            <Tabs.Screen name="materials" options={{ href: null }} />
            <Tabs.Screen name="schedule" options={{ href: null }} />
            <Tabs.Screen name="marketplace" options={{ href: null }} />
            <Tabs.Screen name="subs" options={{ href: null }} />
            <Tabs.Screen name="equipment" options={{ href: null }} />
          </Tabs>
        </View>
        {showActionRail && <DesktopActionRail />}
      </View>
    );
  }

  return (
    <Tabs
      // (home) lands fresh users on the proper EmptyState with a CTA —
      // the previous `summary` default had no CTA, just text saying
      // "Create a project from the Projects tab" forcing new users to
      // discover the tab switch on their own.
      initialRouteName="(home)"
      screenListeners={{
        tabPress: () => {
          if (Platform.OS === 'ios') {
            Haptics.selectionAsync().catch(() => {});
          }
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: themeColors.accent,
        tabBarInactiveTintColor: themeColors.textSecondary,
        tabBarStyle: {
          backgroundColor: themeColors.surface,
          borderTopColor: themeColors.line,
          borderTopWidth: 0.5,
        },
        tabBarLabelStyle: {
          fontSize: Type.caption2.fontSize,
          fontWeight: '500',
          letterSpacing: 0.2,
          marginBottom: Platform.OS === 'ios' ? 0 : 4,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
      }}
    >
      {/* Summary — financial overview, contractor-only. Clients have
          no jobs-in-progress totals to summarize. */}
      <Tabs.Screen
        name="summary"
        options={isMinimalPersona ? { href: null } : {
          title: 'Summary',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={MageSummary} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="(home)"
        options={{
          // Clients see this tab labeled "Home" because it renders the
          // property-owner hub (post a project, active RFPs, in-progress).
          // Contractors keep the original "Your Projects" label.
          title: isMinimalPersona ? 'Home' : 'Your Projects',
          tabBarBadge: attentionBadge,
          tabBarBadgeStyle: { backgroundColor: themeColors.danger, color: '#FFFFFF' },
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={MageProject} color={color} focused={focused} />
          ),
        }}
      />
      {/* Estimate hub is NOT a bottom tab — it lives inside the Discover
          section ("Estimator" card → /(tabs)/discover/estimate → the hub).
          href:null keeps the route registered without a tab. */}
      <Tabs.Screen name="estimate" options={{ href: null }} />
      {/* Discover hosts public-bid search, supplier marketplace, hire — all
          contractor-shaped. Hidden for clients; they reach their needs
          (post RFP, review bids) from the Home hub. */}
      <Tabs.Screen
        name="discover"
        options={isMinimalPersona ? { href: null } : {
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={MageDiscover} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Settings} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen name="materials" options={{ href: null }} />
      <Tabs.Screen name="schedule" options={{ href: null }} />
      <Tabs.Screen name="marketplace" options={{ href: null }} />
      <Tabs.Screen name="subs" options={{ href: null }} />
      <Tabs.Screen name="equipment" options={{ href: null }} />
      <Tabs.Screen name="mage-id-bids" options={{ href: null }} />
      <Tabs.Screen name="construction-ai" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  desktopContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  desktopContent: {
    flex: 1,
  },
});
