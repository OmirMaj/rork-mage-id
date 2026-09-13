import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { AlertTriangle, RefreshCw, Home, ChevronLeft } from 'lucide-react-native';
import * as Sentry from '@sentry/react-native';
import { router } from 'expo-router';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  static displayName = 'ErrorBoundary';

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    console.log('[ErrorBoundary] Caught error:', error.message);
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.log('[ErrorBoundary] Error details:', error.message);
    console.log('[ErrorBoundary] Component stack:', errorInfo.componentStack);
    // Forward to Sentry so we get the React component stack alongside
    // the JS stack trace. Sentry's auto-capture catches uncaught errors
    // but not ones React's error boundary intercepts before they bubble.
    Sentry.captureException(error, {
      contexts: {
        react: { componentStack: errorInfo.componentStack ?? 'n/a' },
      },
    });
  }

  handleReset = () => {
    console.log('[ErrorBoundary] Resetting error state');
    this.setState({ hasError: false, error: null });
  };

  /**
   * The way OUT of the state that just crashed.
   *
   * Runtime audit 2026-09-06, MISS-03: "Try Again" only cleared `hasError`,
   * which re-renders the identical subtree on the identical route. A
   * "Maximum update depth exceeded" loop is deterministic, so retrying
   * re-crashed immediately and force-quitting the app was the only exit.
   *
   * This boundary wraps the WHOLE tree (app/_layout.tsx), so while the
   * fallback is on screen the router is unmounted and there is nothing for
   * `router.replace('/')` to act on. The only reliable reset is to restart
   * the JS bundle, which lands the user on the app's initial route with none
   * of the state that produced the loop:
   *   • native  → expo-updates `reloadAsync()` (lazy `require` + try/catch,
   *               same shape settings/index.tsx uses, because the module
   *               binds native code that a web or bare dev build can throw on)
   *   • web     → a real document navigation to the origin root
   *   • neither → fall back to clearing the boundary, which is still no worse
   *               than the old single button.
   */
  handleGoHome = () => {
    console.log('[ErrorBoundary] Restarting at home');
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && window.location) {
          window.location.assign('/');
          return;
        }
      } catch {
        /* fall through to the in-place reset */
      }
      this.handleReset();
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Updates = require('expo-updates') as { reloadAsync?: () => Promise<void> };
      if (typeof Updates.reloadAsync === 'function') {
        void Updates.reloadAsync().catch(() => this.handleReset());
        return;
      }
    } catch {
      /* no updates module on this platform / build */
    }
    this.handleReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          message={this.props.fallbackMessage}
          onReset={this.handleReset}
          onGoHome={this.handleGoHome}
        />
      );
    }

    return this.props.children;
  }
}

// ErrorFallback must NEVER depend on ThemeProvider / useThemedStyles /
// Tokens because this component is the last line of defense — if a child
// crash takes out the theme stack, the fallback still has to render. The
// previous version called useTheme() inside ErrorFallback which threw
// "Cannot destructure 'colors' of useTheme(...) as it is undefined" and
// the user saw a blank white screen instead of the recover UI.
//
// All colors / radii / font sizes here are hardcoded to safe light-mode
// values that work in both themes against a neutral background.
function ErrorFallback({
  error, message, onReset, onGoHome,
  primaryLabel = 'Restart at Home',
  primaryIcon = <Home size={16} color="#FFFFFF" strokeWidth={2} />,
}: {
  error: Error | null;
  message?: string;
  onReset: () => void;
  onGoHome: () => void;
  /** RouteErrorFallback re-labels the primary button: inside the router the
   *  way out is one screen back, not a bundle restart. The testID stays put —
   *  see the button below. */
  primaryLabel?: string;
  primaryIcon?: ReactNode;
}) {
  return (
    /* The card grew with this fix (errorBox 80 -> 200pt, plus a second 47pt
       button), and `fallbackMessage` is a caller-supplied prop that can run to
       three or four lines. On the shortest supported device (667pt iPhone SE)
       a long message would push "Try Again" off the bottom of a centred,
       non-scrolling View — on the one screen whose entire job is to offer a
       way out. A ScrollView makes reaching both buttons unconditional; when
       the card is shorter than the viewport, `flexGrow: 1` + `center` keeps it
       exactly where it was. */
    <ScrollView
      style={fallbackStyles.scroll}
      contentContainerStyle={fallbackStyles.container}
      showsVerticalScrollIndicator={false}
    >
      <View style={fallbackStyles.card}>
        <View style={fallbackStyles.iconWrap}>
          <AlertTriangle size={32} color="#FF3B30" strokeWidth={1.8} />
        </View>
        <Text style={fallbackStyles.title}>Something went wrong</Text>
        <Text style={fallbackStyles.message}>
          {message || 'The app encountered an unexpected error. Please try again.'}
        </Text>
        {error && (
          <ScrollView
            style={fallbackStyles.errorBox}
            contentContainerStyle={fallbackStyles.errorBoxContent}
            horizontal={false}
            nestedScrollEnabled
            showsVerticalScrollIndicator
            persistentScrollbar
            testID="error-boundary-message"
          >
            <Text style={fallbackStyles.errorText}>{error.message}</Text>
          </ScrollView>
        )}
        <TouchableOpacity
          style={fallbackStyles.homeButton}
          onPress={onGoHome}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          // LITERAL, on BOTH cards, and it must stay that way: this exact
          // string is what validate-contrast Check 7 (MISS-03) greps this file
          // for as the proof that the crash screen offers a route out and not
          // just a re-crash. Routing it through a prop default took that guard
          // — and therefore all 231 of ship-check — red, because the string
          // then only existed in single quotes in a parameter list (review
          // 2026-09-07). The route card is told apart by its own wrapper
          // testID, not by re-labelling this button.
          testID="error-boundary-home"
        >
          {primaryIcon}
          <Text style={fallbackStyles.homeText}>{primaryLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={fallbackStyles.retryButton}
          onPress={onReset}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          testID="error-boundary-retry"
        >
          <RefreshCw size={16} color="#8A2E05" strokeWidth={2} />
          <Text style={fallbackStyles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

/**
 * RouteErrorFallback — the SAME card, one route down, so a crash in one screen
 * costs one screen.
 *
 * WHY. Audit 2026-09-07, "Worth doing" #8: the boundary above is the only one
 * in the repo and it wraps the whole tree, which is exactly why its own comment
 * has to explain that recovery means restarting the JS bundle — while the
 * fallback is up, the router is unmounted and there is nothing for
 * `router.back()` to act on. A render bug in one card halfway through a daily
 * report therefore blanked and restarted the entire app at its initial route,
 * with every unsaved field gone.
 *
 * expo-router already has the mechanism: a route (or layout) module that
 * exports `ErrorBoundary` gets wrapped in its own `<Try>`, so the failure is
 * contained to that route and the router above it stays mounted. Adopt it with
 * one line at the top of a screen:
 *
 *   export { RouteErrorFallback as ErrorBoundary } from '@/components/ErrorBoundary';
 *
 * `retry` is expo-router's own — it clears the caught error and re-renders the
 * route, which is the right first move for a transient render failure and is
 * NOT the useless retry MISS-03 removed above (that one re-rendered a whole
 * tree whose state had already deadlocked).
 *
 * Same no-theme discipline as ErrorFallback: this can be rendering because the
 * theme stack itself threw. And `<Try>` does not report anywhere, so the
 * capture that ErrorBoundary.componentDidCatch does for the root has to happen
 * here — once per distinct error, not on every re-render.
 */
export function RouteErrorFallback({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  React.useEffect(() => {
    console.log('[RouteErrorFallback] Caught route error:', error?.message);
    Sentry.captureException(error, { tags: { boundary: 'route' } });
  }, [error]);

  const goBack = React.useCallback(() => {
    // Mirrors hooks/useSafeBack (UX-F18): on a screen opened as the FIRST
    // route — a notification cold start, a fresh web tab — `back()` is an
    // unhandled GO_BACK and the button would do nothing on the one screen
    // whose entire job is to offer a way out.
    try {
      if (router.canGoBack()) { router.back(); return; }
      router.replace('/(tabs)/(home)');
      // …and clear the caught error, because the replace may be a no-op.
      // <Try> holds `error` in ITS OWN component state, keyed to this route
      // (expo-router/build/views/Try.js) — navigating does not reset it. The
      // home screen is the app's initial route, so a crash there is exactly
      // the case where canGoBack() is false and the replace target is the
      // route already on screen: without this, the primary button on the most
      // likely crash site in the app did visibly nothing (review fix,
      // 2026-09-07). Retrying re-renders the destination; a transient failure
      // clears, a deterministic one lands back on this card, which is honest.
      void retry();
    } catch {
      // The router itself is what crashed. Leave the user on the card with
      // Try Again rather than throwing inside the fallback.
    }
  }, [retry]);

  return (
    // The wrapper carries the route card's identity so the button underneath
    // can keep the literal testID the contrast guard pins (see above).
    <View style={fallbackStyles.scroll} testID="route-error-fallback">
      <ErrorFallback
        error={error}
        message="This screen ran into a problem. The rest of the app is fine — go back and try it again."
        onReset={() => { void retry(); }}
        onGoHome={goBack}
        primaryLabel="Go Back"
        primaryIcon={<ChevronLeft size={16} color="#FFFFFF" strokeWidth={2} />}
      />
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#F2F2F7',
  },
  // The ScrollView's CONTENT container: flexGrow (not flex) so a short card
  // still centres in the viewport while a tall one is allowed to overflow and
  // scroll instead of clipping its own buttons.
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    width: '100%',
    maxWidth: 380,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FFE5E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    // rgba(60,60,67,0.6) measured 3.44:1 on this white card — below AA, on the
    // one screen whose entire job is to be read. 0.82 → 6.33:1.
    color: 'rgba(60,60,67,0.82)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  // MISS-03: at maxHeight 80 with 12px monospace this fitted about five lines
  // and the captured message was six, so it was cut mid-sentence with no
  // scroll affordance. 200 fits ~11 lines, the scrollbar is now persistent,
  // and the text wraps with real leading instead of hugging the box edge.
  errorBox: {
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    width: '100%',
    maxHeight: 200,
    marginBottom: 20,
  },
  errorBoxContent: {
    padding: 12,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 17,
    // #FF3B30 on #F2F2F7 is 3.18:1. #A32118 is 6.75:1 and still reads red.
    color: '#A32118',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // MISS-03: the single button was hardcoded #1A6B3C — the RETIRED forest-green
  // brand, the one place in the app where it still shipped. Primary CTAs are
  // MAGE orange; #BC440C is the accessible accent fill (white on it = 5.29:1,
  // the same value constants/colors.ts documents as founder decision #1).
  // Hardcoded rather than imported because this component must render with the
  // theme stack dead — see the note above ErrorFallback.
  homeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#BC440C',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
  },
  homeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(188,68,12,0.35)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    marginTop: 10,
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
    // #8A2E05 on white = 8.49:1; the accent fill itself would be 5.29:1 but
    // this is the secondary action, so it reads as ink rather than a button.
    color: '#8A2E05',
  },
});
