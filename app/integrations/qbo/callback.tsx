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
//    then hand the user back to the native app via the mageid:// deep link.
//
//  - NATIVE (rare): if Universal Links are ever set up, iOS would intercept
//    the redirect, return the URL to openAuthSessionAsync, and our
//    connectQuickBooks() would call completeQuickBooksCallback() itself —
//    this page would never load on native. Kept compatible anyway so a
//    direct mageid://integrations/qbo/callback?code=... still works.
//
// The page runs WITHOUT authentication on web: a fresh browser session has no
// MAGE auth, but the qbo-connect-callback edge function is JWT-disabled and
// trusts the signed state token for identity. So the user can complete the
// flow even if they're not logged into the web build.

import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { PRIMARY_SCHEME } from "@/utils/deepLinkScheme";
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
  const router = useRouter();
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

  // 2) On success, get the user back to qbo-setup, where the polling loop
  // detects the freshly-saved connection.
  //
  // THIS PAGE SERVES TWO AUDIENCES, BOTH Platform.OS === 'web':
  //   (a) iOS's ASWebAuthenticationSession rendering the web build. Here the
  //       mageid:// custom scheme is exactly right — iOS intercepts it, closes
  //       the browser session, and hands off to the native app.
  //   (b) An actual browser (someone using the web app on a desktop). A
  //       custom-scheme navigation there does nothing, or pops a "Safari can't
  //       open the page" dialog.
  //
  // The old code only did (a), and the manual button did the same thing — so a
  // web user finished the OAuth successfully and was then STRANDED on this
  // page with no route back into the app. The connection was saved and they
  // could not see it.
  //
  // Try the deep link first (cheap, and correct for (a)); if we are still
  // visible shortly after, nothing took the handoff, so continue INSIDE the web
  // app. document.visibilityState is the signal — iOS backgrounds this page
  // when it switches to the native app.
  useEffect(() => {
    if (status !== "success") return;
    const deepLink = `${PRIMARY_SCHEME}qbo-setup`;
    let fallback: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      if (Platform.OS !== "web") {
        void Linking.openURL(deepLink).catch(() => { /* manual button is the fallback */ });
        return;
      }
      try { window.location.href = deepLink; } catch { /* fall through to the in-app route */ }
      fallback = setTimeout(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        router.replace("/qbo-setup");
      }, 1500);
    }, 1200);
    return () => { clearTimeout(t); if (fallback) clearTimeout(fallback); };
  }, [status, router]);

  // The manual affordance must be the RELIABLE one, not a second copy of the
  // thing that may already have failed. On web that means an in-app route,
  // which always works; the deep-link attempt above already covered the
  // in-app-browser case.
  const openMage = () => {
    if (Platform.OS === "web") {
      router.replace("/qbo-setup");
      return;
    }
    void Linking.openURL(`${PRIMARY_SCHEME}qbo-setup`);
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
            <Text style={styles.hint}>{Platform.OS === "web" ? "Taking you back…" : "Returning you to the MAGE app…"}</Text>
            <TouchableOpacity style={styles.primary} onPress={openMage} testID="qbo-callback-return">
              <ExternalLink size={16} color="#FFFFFF" strokeWidth={1.75} />
              <Text style={styles.primaryText}>{Platform.OS === "web" ? "Continue to QuickBooks setup" : "Open MAGE app"}</Text>
            </TouchableOpacity>
          </>
        )}
        {status === "error" && (
          <>
            <AlertTriangle size={64} color={colors.danger} strokeWidth={1.75} />
            <Text style={styles.title}>Connection failed</Text>
            <Text style={styles.subtitle}>{error ?? "Unknown error."}</Text>
            <Text style={styles.hint}>{Platform.OS === "web" ? "Go back and try connecting again." : "Return to the MAGE app and try connecting again."}</Text>
            <TouchableOpacity style={styles.primary} onPress={openMage} testID="qbo-callback-return-err">
              <Text style={styles.primaryText}>{Platform.OS === "web" ? "Back to QuickBooks setup" : "Return to MAGE"}</Text>
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
    backgroundColor: t.accentFill,
    minWidth: 220,
  },
  primaryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800" as const,
  },
});
