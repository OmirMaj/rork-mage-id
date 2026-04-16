import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { BidsProvider } from "@/contexts/BidsContext";
import { ProfileProvider } from "@/contexts/ProfileContext";
import { CompaniesProvider } from "@/contexts/CompaniesContext";
import { Colors } from "@/constants/colors";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{
      headerBackTitle: "Back",
      headerStyle: { backgroundColor: Colors.background },
      headerTintColor: Colors.primary,
      headerTitleStyle: { fontWeight: '600' as const, color: Colors.text },
      headerShadowVisible: false,
    }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="signup" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="paywall" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="post-bid" options={{ presentation: "modal", title: "Post Bid" }} />
      <Stack.Screen name="post-project" options={{ presentation: "modal", title: "Post Project" }} />
      <Stack.Screen name="post-job" options={{ presentation: "modal", title: "Post Job" }} />
      <Stack.Screen name="submit-bid-response" options={{ presentation: "modal", title: "Submit Bid" }} />
      <Stack.Screen name="bid-detail" options={{ title: "Bid Details" }} />
      <Stack.Screen name="bid-responses" options={{ title: "Bid Responses" }} />
      <Stack.Screen name="project-detail" options={{ title: "Project" }} />
      <Stack.Screen name="messages" options={{ title: "Messages" }} />
      <Stack.Screen name="contractor-profile" options={{ title: "My Profile" }} />
      <Stack.Screen name="profile-view" options={{ title: "Profile" }} />
      <Stack.Screen name="templates" options={{ title: "Templates" }} />
      <Stack.Screen name="invoice" options={{ title: "Invoice" }} />
      <Stack.Screen name="daily-report" options={{ title: "Daily Report" }} />
      <Stack.Screen name="change-order" options={{ title: "Change Order" }} />
      <Stack.Screen name="permits" options={{ title: "Permits" }} />
      <Stack.Screen name="documents" options={{ title: "Documents" }} />
      <Stack.Screen name="contacts" options={{ title: "Contacts" }} />
      <Stack.Screen name="rfi" options={{ title: "RFI" }} />
      <Stack.Screen name="submittal" options={{ title: "Submittal" }} />
      <Stack.Screen name="time-tracking" options={{ title: "Time Tracking" }} />
      <Stack.Screen name="punch-list" options={{ title: "Punch List" }} />
      <Stack.Screen name="cash-flow" options={{ title: "Cash Flow" }} />
      <Stack.Screen name="budget-dashboard" options={{ title: "Budget Dashboard" }} />
      <Stack.Screen name="payments" options={{ title: "Payments" }} />
      <Stack.Screen name="equipment-detail" options={{ title: "Equipment" }} />
      <Stack.Screen name="worker-detail" options={{ title: "Worker" }} />
      <Stack.Screen name="company-detail" options={{ title: "Company" }} />
      <Stack.Screen name="job-detail" options={{ title: "Job Details" }} />
      <Stack.Screen name="integrations" options={{ title: "Integrations" }} />
      <Stack.Screen name="client-portal" options={{ title: "Client Portal" }} />
      <Stack.Screen name="create-schedule" options={{ title: "Create Schedule" }} />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AuthProvider>
          <SubscriptionProvider>
            <ProjectProvider>
              <BidsProvider>
                <ProfileProvider>
                  <CompaniesProvider>
                    <RootLayoutNav />
                  </CompaniesProvider>
                </ProfileProvider>
              </BidsProvider>
            </ProjectProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

