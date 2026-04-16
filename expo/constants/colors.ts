export let Colors: Record<string, string> = {
  primary: '#1A6B3C',
  primaryLight: '#E8F5EC',
  accent: '#FF9500',
  accentLight: '#FFF3E0',

  background: '#F5F6F8',
  surface: '#FFFFFF',
  card: '#FFFFFF',

  text: '#1A1A2E',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',

  borderLight: '#E5E7EB',
  cardBorder: '#E5E7EB',

  fillSecondary: '#F3F4F6',
  fillTertiary: '#F0F1F3',

  success: '#16A34A',
  successLight: '#DCFCE7',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  info: '#2563EB',
  infoLight: '#DBEAFE',

  federal: '#1565C0',
  federalLight: '#E3F2FD',
  community: '#7B1FA2',
  communityLight: '#F3E5F5',
  homeowner: '#0D9488',
  homeownerLight: '#CCFBF1',

  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  tabBarActive: '#1A6B3C',
  tabBarInactive: '#9CA3AF',

  surfaceAlt: '#F9FAFB',
  textOnPrimary: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.5)',
  primaryDark: '#145530',
  border: '#D1D5DB',
};

export function setCustomColors(primary: string, accent: string) {
  Colors = { ...Colors, primary, accent, primaryLight: primary + '15', tabBarActive: primary };
}

export default {
  light: {
    text: Colors.text,
    background: Colors.background,
    tint: Colors.primary,
    tabIconDefault: Colors.tabBarInactive,
    tabIconSelected: Colors.tabBarActive,
  },
};
