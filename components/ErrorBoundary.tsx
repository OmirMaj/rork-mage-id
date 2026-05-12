import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';
import * as Sentry from '@sentry/react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

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

function ErrorFallback({
  error, message, onReset,
}: {
  error: Error | null;
  message?: string;
  onReset: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <AlertTriangle size={32} color={themeColors.danger} strokeWidth={1.8} />
        </View>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          {message || 'The app encountered an unexpected error. Please try again.'}
        </Text>
        {error && (
          <ScrollView style={styles.errorBox} horizontal={false}>
            <Text style={styles.errorText}>{error.message}</Text>
          </ScrollView>
        )}
        <TouchableOpacity
          style={styles.retryButton}
          onPress={onReset}
          activeOpacity={0.8}
          testID="error-boundary-retry"
        >
          <RefreshCw size={16} color={'#FFFFFF'} strokeWidth={2} />
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
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
    backgroundColor: Colors.errorLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: Type.subhead.fontSize,
    color: 'rgba(60,60,67,0.6)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  errorBox: {
    backgroundColor: '#F2F2F7',
    borderRadius: Tokens.radius.md,
    padding: 12,
    width: '100%',
    maxHeight: 80,
    marginBottom: 20,
  },
  errorText: {
    fontSize: Type.caption1.fontSize,
    color: t.danger,
    fontFamily: 'monospace',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1A6B3C',
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
  },
  retryText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.surface,
  },
});
