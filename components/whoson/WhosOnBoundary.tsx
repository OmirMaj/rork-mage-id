// components/whoson/WhosOnBoundary.tsx — the project page, the Team section
// and Settings must never reach the app's error boundary because of the
// "who is on this project" feature (whoson spec 3.3, last row). Anything a
// whoson component throws while rendering ends here: logged once, and the
// component draws nothing, which is what every one of them draws when it does
// not know.
import React from 'react';

let logged = false;

export class WhosOnBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    if (logged) return;
    logged = true;
    console.warn('[WhosOn] a component failed and was hidden:', error instanceof Error ? error.message : String(error));
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export default WhosOnBoundary;
