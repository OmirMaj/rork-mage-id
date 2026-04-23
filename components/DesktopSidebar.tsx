import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home, Compass, Wrench, Settings, BarChart3, CalendarDays,
  Hammer, FileText, Building2, Search, HardHat, Gavel, LayoutDashboard,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useSearch } from '@/contexts/SearchContext';

interface NavItem {
  key: string;
  label: string;
  icon: typeof Home;
  route: string;
  section: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'summary', label: 'Summary', icon: LayoutDashboard, route: '/(tabs)/summary', section: 'PROJECT' },
  { key: 'home', label: 'Projects', icon: Home, route: '/(tabs)/(home)', section: 'PROJECT' },
  { key: 'estimate', label: 'Estimate', icon: BarChart3, route: '/(tabs)/discover/estimate', section: 'PROJECT' },
  { key: 'schedule', label: 'Schedule', icon: CalendarDays, route: '/(tabs)/discover/schedule', section: 'PROJECT' },
  { key: 'equipment', label: 'Equipment', icon: Hammer, route: '/(tabs)/equipment', section: 'FIELD' },
  { key: 'bids', label: 'Bids', icon: FileText, route: '/(tabs)/bids', section: 'FIELD' },
  { key: 'companies', label: 'Companies', icon: Building2, route: '/(tabs)/companies', section: 'NETWORK' },
  { key: 'discover', label: 'Discover', icon: Search, route: '/(tabs)/discover', section: 'NETWORK' },
  { key: 'hire', label: 'Hire', icon: HardHat, route: '/(tabs)/hire', section: 'NETWORK' },
  { key: 'construction-ai', label: 'Construction AI', icon: Gavel, route: '/(tabs)/construction-ai', section: 'NETWORK' },
  { key: 'settings', label: 'Settings', icon: Settings, route: '/(tabs)/settings', section: 'ACCOUNT' },
];

const SECTIONS = ['PROJECT', 'FIELD', 'NETWORK', 'ACCOUNT'];

function isActiveRoute(pathname: string, navKey: string): boolean {
  if (navKey === 'summary') return pathname.includes('summary');
  if (navKey === 'home') return pathname === '/' || pathname.includes('(home)');
  if (navKey === 'estimate') return pathname.includes('estimate');
  if (navKey === 'schedule') return pathname.includes('schedule');
  if (navKey === 'equipment') return pathname.includes('equipment');
  if (navKey === 'bids') return pathname.includes('bids');
  if (navKey === 'construction-ai') return pathname.includes('construction-ai');
  if (navKey === 'companies') return pathname.includes('companies');
  if (navKey === 'discover') return pathname.includes('discover');
  if (navKey === 'hire') return pathname.includes('hire');
  if (navKey === 'settings') return pathname.includes('settings');
  return false;
}

interface DesktopSidebarProps {
  width: number;
}

const DesktopSidebar = React.memo(function DesktopSidebar({ width }: DesktopSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { openSearch } = useSearch();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const handleNav = useCallback((route: string) => {
    router.push(route as any);
  }, [router]);

  const groupedItems = SECTIONS.map(section => ({
    section,
    items: NAV_ITEMS.filter(item => item.section === section),
  }));

  return (
    <View style={[styles.container, { width, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.brandSection}>
        <View style={styles.brandIcon}>
          <Wrench size={20} color={Colors.textOnPrimary} />
        </View>
        <Text style={styles.brandName}>MAGE ID</Text>
        <Text style={styles.brandTagline}>Construction Suite</Text>
      </View>

      <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.navSection}>
          <TouchableOpacity
            style={[styles.navItem, styles.searchItem]}
            onPress={openSearch}
            activeOpacity={0.7}
            {...(Platform.OS === 'web' ? {
              onMouseEnter: () => setHoveredKey('__search'),
              onMouseLeave: () => setHoveredKey(null),
            } as any : {})}
            testID="sidebar-search"
          >
            <Search
              size={18}
              color={hoveredKey === '__search' ? Colors.text : Colors.textSecondary}
              strokeWidth={1.8}
            />
            <Text style={[styles.navLabel, hoveredKey === '__search' && styles.navLabelHovered]}>
              Search
            </Text>
            {Platform.OS === 'web' && (
              <View style={styles.kbdWrap}>
                <Text style={styles.kbd}>⌘K</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
        {groupedItems.map(({ section, items }) => (
          <View key={section} style={styles.navSection}>
            <Text style={styles.sectionLabel}>{section}</Text>
            {items.map(item => {
              const active = isActiveRoute(pathname, item.key);
              const hovered = hoveredKey === item.key;
              const Icon = item.icon;

              return (
                <TouchableOpacity
                  key={item.key}
                  style={[
                    styles.navItem,
                    active && styles.navItemActive,
                    hovered && !active && styles.navItemHovered,
                  ]}
                  onPress={() => handleNav(item.route)}
                  activeOpacity={0.7}
                  {...(Platform.OS === 'web' ? {
                    onMouseEnter: () => setHoveredKey(item.key),
                    onMouseLeave: () => setHoveredKey(null),
                  } as any : {})}
                  testID={`sidebar-${item.key}`}
                >
                  {active && <View style={styles.activeIndicator} />}
                  <Icon
                    size={18}
                    color={active ? Colors.primary : hovered ? Colors.text : Colors.textSecondary}
                    strokeWidth={active ? 2.2 : 1.8}
                  />
                  <Text style={[
                    styles.navLabel,
                    active && styles.navLabelActive,
                    hovered && !active && styles.navLabelHovered,
                  ]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footerDivider} />
        <Text style={styles.footerText}>MAGE ID v2.0</Text>
        <Text style={styles.footerSubtext}>Desktop Mode</Text>
      </View>
    </View>
  );
});

export default DesktopSidebar;

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1C1C1E',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 12,
  },
  brandSection: {
    alignItems: 'center' as const,
    paddingBottom: 20,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 8,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  brandTagline: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500' as const,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  navScroll: {
    flex: 1,
  },
  navSection: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.3)',
    letterSpacing: 1.2,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 2,
    position: 'relative' as const,
  },
  navItemActive: {
    backgroundColor: Colors.primary + '15',
  },
  navItemHovered: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  activeIndicator: {
    position: 'absolute' as const,
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: 'rgba(255,255,255,0.6)',
  },
  navLabelActive: {
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  navLabelHovered: {
    color: '#FFFFFF',
  },
  searchItem: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  kbdWrap: {
    marginLeft: 'auto' as const,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  kbd: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 0.3,
  },
  footer: {
    alignItems: 'center' as const,
    paddingTop: 12,
  },
  footerDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignSelf: 'stretch' as const,
    marginBottom: 12,
  },
  footerText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: 'rgba(255,255,255,0.25)',
    letterSpacing: 0.5,
  },
  footerSubtext: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.15)',
    marginTop: 2,
  },
});
