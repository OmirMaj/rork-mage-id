import { Stack } from 'expo-router';

export default function HomeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, orientation: 'portrait_up' }} />
  );
}
