// app/integrations/qbo/callback.tsx
//
// OAuth callback handler for QuickBooks Online 2-way sync.
//
// This route is the redirect target Intuit sends the user to after they
// approve the OAuth grant. The same page works on both:
//
//  - WEB (the primary path): served from app.mageid.app/integrations/qbo/callback.
//    iOS's ASWebAuthenticationSession does NOT intercept HTTPS redirects
//    unless Universal Links are configured — so the in-app browser actually
//    navigates here. We complete the token exchange via the edge function
//    (which doesn't require auth — trust root is the signed state HMAC),
//    then hand the user back to the native app via the rork-app:// deep link.
//
//  - NATIVE (rare): if Universal Links are ever set up, iOS would intercept
//    the redirect, return the URL to openAuthSessionAsync, and our
//    connectQuickBooks() would call completeQuickBooksCallback() itself —
//    this page would never load on native. Kept compatible anyway so a
//    direct rork-app://integrations/qbo/callback?code=... still works.
//
// The page runs WITHOUT authentication on web: a fresh browser session has no
// MAGE auth, but the qbo-connect-callback edge function is JWT-disabled and
// trusts the signed state token for identity. So the user can complete the
// flow even if they're not logged into the web build.

import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { AlertTriangle, ExternalLink } from "lucide-react-native";
import { useTheme } from "@/contexts/ThemeContext";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import type { ThemeColors } from "@/constants/colors";
import { Tokens } from "@/constants/designTokens";
import { Type } from "@/constants/typography";
import { completeQuickBooksCallback } from "@/utils/qboSync";
import { QboSuccessCheckmark } from "@/components/QboSuccessCheckmark";

type Status = "pending" | "success" | "error";

export default function QboCallbackScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string; realmId?: string; state?: string }>();
  const [status, setStatus] = useState<Status>("pending");
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);

  // 1) Run the token exchange on mount. Idempotent against being called
  // twice (Intuit invalidates the code on first use; a second attempt would
  // return invalid_grant — we surface that as an error so the user retries).
  useEffect(() => {
    const code = typeof params.code === "string" ? params.code : null;
    const realmId = typeof params.realmId === "string" ? params.realmId : null;
    const state = typeof params.state === "string" ? params.state : null;
    if (!code || !realmId || !state) {
      setStatus("error");
      setError("Missing code, realmId, or state in the callback URL.");
      return;
    }
    let cancelled = false;
    void completeQuickBooksCallback({ code, realmId, state }).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setStatus("success");
        setCompanyName(r.companyName ?? null);
      } else {
        setStatus("error");
        setError(r.error ?? "Token exchange failed.");
      }
    });
    return () => { cancelled = true; };
  }, [params.code, params.realmId, params.state]);

  // 2) On success, auto-deep-link back to the native MAGE app. This both
  // closes the in-app browser session (iOS intercepts custom-scheme
  // navigations) AND brings the user back to the qbo-setup screen, where
  // the polling loop will detect the freshly-saved connection.
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(() => {
      const deepLink = "rork-app://qbo-setup";
      if (Platform.OS === "web") {
        // From the in-app browser, this navigates to the custom scheme,
        // which iOS hands off to the host app. On desktop browsers without
        // the app installed, it silently no-ops — user uses the button below.
        try { window.location.href = deepLink; } catch { /* manual button is the fallback */ }
      } else {
        void Linking.openURL(deepLink).catch(() => { /* manual button is the fallback */ });
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [status]);

  const openMage = () => {
    const deepLink = "rork-app://qbo-setup";
    if (Platform.OS === "web") {
      try { window.location.href = deepLink; } catch { /* no-op */ }
    } else {
      void Linking.openURL(deepLink);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.center}>
        {status === "pending" && (
          <>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={styles.title}>Connecting QuickBooks…</Text>
            <Text style={styles.subtitle}>One moment while we finalize your connection.</Text>
          </>
        )}
        {status === "success" && (
          <>
            <QboSuccessCheckmark size={96} color={colors.success} />
            <Text style={styles.title}>Connected!</Text>
            <Text style={styles.subtitle}>
              {companyName ? `MAGE is now linked to ${companyName}.` : "MAGE is now linked to your QuickBooks Online account."}
            </Text>
            <Text style={styles.hint}>Returning you to the MAGE app…</Text>
            <TouchableOpacity style={styles.primary} onPress={openMage} testID="qbo-callback-return">
              <ExternalLink size={16} color="#FFFFFF" />
              <Text style={styles.primaryText}>Open MAGE app</Text>
            </TouchableOpacity>
          </>
        )}
        {status === "error" && (
          <>
            <AlertTriangle size={64} color={colors.danger} />
            <Text style={styles.title}>Connection failed</Text>
            <Text style={styles.subtitle}>{error ?? "Unknown error."}</Text>
            <Text style={styles.hint}>Return to the MAGE app and try connecting again.</Text>
            <TouchableOpacity style={styles.primary} onPress={openMage} testID="qbo-callback-return-err">
              <Text style={styles.primaryText}>Return to MAGE</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  center: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: Type.title3.fontSize,
    fontWeight: "800" as const,
    color: t.text,
    textAlign: "center" as const,
    marginTop: 16,
  },
  subtitle: {
    fontSize: Type.body.fontSize,
    color: t.textMuted,
    textAlign: "center" as const,
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  hint: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    textAlign: "center" as const,
    marginTop: 4,
  },
  primary: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    minWidth: 220,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800" as const,
  },
});
