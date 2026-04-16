import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function DiscoverLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '600' as const, fontSize: 17, color: Colors.text },
        headerShadowVisible: false,
        headerBackTitle: 'Back',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="bids" options={{ title: 'Public Bids' }} />
      <Stack.Screen name="companies" options={{ title: 'Companies' }} />
      <Stack.Screen name="hire" options={{ title: 'Hire Board' }} />
    </Stack>
  );
}

