import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import * as Sentry from '@sentry/react-native';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
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

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          message={this.props.fallbackMessage}
          onReset={this.handleReset}
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
  error, message, onReset,
}: {
  error: Error | null;
  message?: string;
  onReset: () => void;
}) {
  return (
    <View style={fallbackStyles.container}>
      <View style={fallbackStyles.card}>
        <View style={fallbackStyles.iconWrap}>
          <AlertTriangle size={32} color="#FF3B30" strokeWidth={1.8} />
        </View>
        <Text style={fallbackStyles.title}>Something went wrong</Text>
        <Text style={fallbackStyles.message}>
          {message || 'The app encountered an unexpected error. Please try again.'}
        </Text>
        {error && (
          <ScrollView style={fallbackStyles.errorBox} horizontal={false}>
            <Text style={fallbackStyles.errorText}>{error.message}</Text>
          </ScrollView>
        )}
        <TouchableOpacity
          style={fallbackStyles.retryButton}
          onPress={onReset}
          activeOpacity={0.8}
          testID="error-boundary-retry"
        >
          <RefreshCw size={16} color="#FFFFFF" strokeWidth={2} />
          <Text style={fallbackStyles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const fallbackStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F2F7',
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
    color: 'rgba(60,60,67,0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: '#F2F2F7',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    maxHeight: 80,
    marginBottom: 20,
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    fontFamily: 'monospace',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A6B3C',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
  },
  retryText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
