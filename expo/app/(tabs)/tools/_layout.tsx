import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function ToolsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: {
          backgroundColor: Colors.surface,
        },
        headerTintColor: Colors.primary,
        headerTitleStyle: {
          fontWeight: '600' as const,
          fontSize: 17,
          color: Colors.text,
        },
        headerShadowVisible: false,
        headerBackTitle: 'Tools',
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="estimate" options={{ headerShown: true, title: 'Estimate Builder' }} />
      <Stack.Screen name="materials" options={{ headerShown: true, title: 'Materials Pricing' }} />
      <Stack.Screen name="schedule" options={{ headerShown: true, title: 'Schedule Planner' }} />
    </Stack>
  );
}

