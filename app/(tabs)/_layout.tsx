import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Tabs, Slot } from 'expo-router';
import { Home, Compass, Settings, LayoutDashboard, Hammer } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import DesktopSidebar from '@/components/DesktopSidebar';
import { useSmartInbox } from '@/hooks/useSmartInbox';

/**
 * TabIcon — wraps a tab icon with a focused-state indicator dot
 * underneath. The dot fades + scales in when the tab becomes active,
 * giving every tab a subtle "you are here" cue beyond just color
 * change. Premium-app polish without any extra layout math.
 */
function TabIcon({
  Icon, color, focused,
}: { Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>; color: string; focused: boolean }) {
  const dot = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(dot, {
      toValue: focused ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, dot]);
  return (
    <View style={tabIconStyles.wrap}>
      <Icon size={23} color={color} strokeWidth={focused ? 2.2 : 1.8} />
      <Animated.View
        style={[
          tabIconStyles.dot,
          { backgroundColor: color, opacity: dot, transform: [{ scale: dot }] },
        ]}
      />
    </View>
  );
}

const tabIconStyles = StyleSheet.create({
  wrap: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: 3 },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
});

export default function TabLayout() {
  const layout = useResponsiveLayout();
  const { counts } = useSmartInbox();
  const inboxBadge = counts.all > 0
    ? (counts.all > 99 ? '99+' : String(counts.all))
    : undefined;

  if (layout.showSidebar) {
    return (
      <View style={styles.desktopContainer}>
        <DesktopSidebar width={layout.sidebarWidth} />
        <View style={styles.desktopContent}>
          <Tabs
            screenOptions={{
              headerShown: false,
              tabBarStyle: { display: 'none' },
            }}
          >
            <Tabs.Screen name="summary" options={{ title: 'Summary' }} />
            <Tabs.Screen name="(home)" options={{ title: 'Your Projects' }} />
            <Tabs.Screen name="mage-id-bids" options={{ title: 'MAGE ID Bids' }} />
            <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
            <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
            <Tabs.Screen name="construction-ai" options={{ href: null }} />
            <Tabs.Screen name="bids" options={{ href: null }} />
            <Tabs.Screen name="companies" options={{ href: null }} />
            <Tabs.Screen name="hire" options={{ href: null }} />
            <Tabs.Screen name="estimate" options={{ href: null }} />
            <Tabs.Screen name="materials" options={{ href: null }} />
            <Tabs.Screen name="schedule" options={{ href: null }} />
            <Tabs.Screen name="marketplace" options={{ href: null }} />
            <Tabs.Screen name="subs" options={{ href: null }} />
            <Tabs.Screen name="equipment" options={{ href: null }} />
          </Tabs>
        </View>
      </View>
    );
  }

  return (
    <Tabs
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
          fontSize: 11,
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
          tabBarBadgeStyle: { backgroundColor: '#FF3B30', color: '#FFFFFF' },
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Home} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="mage-id-bids"
        options={{
          title: 'MAGE Bids',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon Icon={Hammer} color={color} focused={focused} />
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
      <Tabs.Screen name="bids" options={{ href: null }} />
      <Tabs.Screen name="companies" options={{ href: null }} />
      <Tabs.Screen name="hire" options={{ href: null }} />
      <Tabs.Screen name="estimate" options={{ href: null }} />
      <Tabs.Screen name="materials" options={{ href: null }} />
      <Tabs.Screen name="schedule" options={{ href: null }} />
      <Tabs.Screen name="marketplace" options={{ href: null }} />
      <Tabs.Screen name="subs" options={{ href: null }} />
      <Tabs.Screen name="equipment" options={{ href: null }} />
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
