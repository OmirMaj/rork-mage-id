import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Tabs, Slot } from 'expo-router';
import { Home, Compass, Settings, LayoutDashboard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import DesktopSidebar from '@/components/DesktopSidebar';
import DesktopActionRail from '@/components/DesktopActionRail';
import { useSmartInbox } from '@/hooks/useSmartInbox';
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
  const { counts } = useSmartInbox();
  const inboxBadge = counts.all > 0
    ? (counts.all > 99 ? '99+' : String(counts.all))
    : undefined;

  // Right-rail "Action Required" column shows on wide desktops (>= 1280px
  // viewport). Below that we don't have horizontal room for a clean three-
  // column layout — the inline SmartInbox in the home tab takes over.
  const showActionRail = layout.isDesktop && layout.width >= 1280;

  if (layout.showSidebar) {
    return (
      <View style={styles.desktopContainer}>
        <DesktopSidebar width={layout.sidebarWidth} />
        <View style={styles.desktopContent}>
          <Tabs
            initialRouteName="(home)"
            screenOptions={{
              headerShown: false,
              tabBarStyle: { display: 'none' },
            }}
          >
            <Tabs.Screen name="summary" options={{ title: 'Summary' }} />
            <Tabs.Screen name="(home)" options={{ title: 'Your Projects' }} />
            <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
            <Tabs.Screen name="construction-ai" options={{ title: 'AI Hub' }} />
            <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
            <Tabs.Screen name="mage-id-bids" options={{ title: 'MAGE ID Bids' }} />
            <Tabs.Screen name="tools" options={{ href: null }} />
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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.borderLight,
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
      <Tabs.Screen
        name="summary"
        options={{
          title: 'Summary',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={LayoutDashboard} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="(home)"
        options={{
          title: 'Your Projects',
          tabBarBadge: inboxBadge,
          tabBarBadgeStyle: { backgroundColor: Colors.error, color: Colors.surface },
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Home} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Compass} color={color} focused={focused} />
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
      <Tabs.Screen name="tools" options={{ href: null }} />
      <Tabs.Screen name="estimate" options={{ href: null }} />
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
