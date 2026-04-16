import { Stack } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function MaterialsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'Materials' }} />
      <Stack.Screen name="[category]" options={{ title: 'Category' }} />
    </Stack>
  );
}

