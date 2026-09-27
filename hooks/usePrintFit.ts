// hooks/usePrintFit.ts — Cmd+P fits a wide canvas onto the sheet (wave 6d
// restore, lane Z1).
//
// Usage, on the canvas's root View (the Schedule Pro Gantt tab, the classic
// GanttChart):
//
//   const printFit = usePrintFit(isDesktop);
//   <View ref={printFit.ref} {...printFit.printProps}>…</View>
//
// On web with `enabled`:
//   - printProps tags the root data-print="fit", so PRINT_CSS
//     (components/desktop/webDocument) applies `zoom: var(--mage-print-fit, 1)`;
//   - on `beforeprint` the root is measured — its own width plus the hidden
//     overflow of every TOP-LEVEL horizontal scroller inside it (the timeline)
//     — and PRINT_FIT_VAR is set to printFitZoom(need, Layout.print
//     .landscapeWidth, Layout.print.fitMin), with a landscape @page appended to
//     <head> (PRINT_PAGE_STYLE_ID);
//   - `afterprint` and unmount remove both. A root that is not rendered at
//     that moment (a screen hidden under the one being printed — the tab
//     navigator and the stack keep them mounted with display:none) does
//     nothing, so it never turns another page's printout landscape.
// Everywhere else (iOS, Android, a phone-width browser): `{}` props and no
// listener — the rendered tree is exactly today's (a ref adds nothing to it).
//
// KNOWN LIMIT: only what is rendered prints. A virtualised row list prints
// the rows it has mounted, and the zoom is clamped at Layout.print.fitMin
// (0.3), below which a very long timeline is cut at the sheet's right edge
// (utils/printFit printFitClips). The whole schedule on paper stays Schedule
// Pro's own Print (handleAirPrint → buildPrintableGanttHtml in
// app/schedule-pro.tsx).

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { Platform, type View } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { PRINT_FIT_VAR, PRINT_PAGE_CSS, PRINT_PAGE_STYLE_ID, printFitZoom } from '@/utils/printFit';

export interface PrintFit {
  ref: RefObject<View | null>;
  /** Spread on the root View: `{ dataSet: { print: 'fit' } }` on web, else `{}`. */
  printProps: object;
}

const NO_PROPS = {};
const FIT_PROPS = { dataSet: { print: 'fit' } };

/** The width the root needs to show everything: its own client width plus
 *  the hidden overflow of each horizontal scroller that is not inside one
 *  already counted. */
function neededWidth(root: HTMLElement): number {
  let need = root.clientWidth;
  const counted: HTMLElement[] = [];
  const nodes = root.querySelectorAll<HTMLElement>('*');
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!(n.scrollWidth > n.clientWidth + 1)) continue;
    if (counted.some((c) => c.contains(n))) continue;
    const ox = window.getComputedStyle(n).overflowX;
    if (ox !== 'auto' && ox !== 'scroll') continue;
    counted.push(n);
    need += n.scrollWidth - n.clientWidth;
  }
  return need;
}

export function usePrintFit(enabled: boolean): PrintFit {
  const ref = useRef<View | null>(null);
  const active = Platform.OS === 'web' && enabled;

  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    let fitted: HTMLElement | null = null;
    let pageStyle: HTMLStyleElement | null = null;

    const clear = () => {
      fitted?.style.removeProperty(PRINT_FIT_VAR);
      fitted = null;
      pageStyle?.remove();
      pageStyle = null;
    };
    const onBeforePrint = () => {
      clear();
      const el = ref.current as unknown as HTMLElement | null;
      // Not rendered (display:none here or above): not the page being printed.
      if (!el || typeof el.getClientRects !== 'function' || el.getClientRects().length === 0) return;
      const zoom = printFitZoom(neededWidth(el), Layout.print.landscapeWidth, Layout.print.fitMin);
      el.style.setProperty(PRINT_FIT_VAR, String(zoom));
      fitted = el;
      if (!document.getElementById(PRINT_PAGE_STYLE_ID)) {
        const s = document.createElement('style');
        s.id = PRINT_PAGE_STYLE_ID;
        s.textContent = PRINT_PAGE_CSS;
        document.head.appendChild(s);
        pageStyle = s;
      }
    };

    window.addEventListener('beforeprint', onBeforePrint);
    window.addEventListener('afterprint', clear);
    return () => {
      window.removeEventListener('beforeprint', onBeforePrint);
      window.removeEventListener('afterprint', clear);
      clear();
    };
  }, [active]);

  return useMemo(() => ({ ref, printProps: active ? FIT_PROPS : NO_PROPS }), [active]);
}
