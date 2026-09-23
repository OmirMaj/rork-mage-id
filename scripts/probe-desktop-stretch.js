// scripts/probe-desktop-stretch.js — a DevTools snippet that measures the
// "phone app stretched out" symptoms on whatever page of the web app is open.
//
// WHY (wave 6b, guard layer 3). The founder runs app.mageid.app on a 1512×945
// MacBook: "the boxes are so stretched out and it looks terrible". Two audits
// measured it live — 1360 px buttons, 1000–1470 px inputs, sub-tabs 328–881 px
// each, modals at full window width over the sidebar. The static guard
// (scripts/validate-desktop-layout.ts) proves a desktop style never reaches a
// phone and that the hand-rolled patterns only go DOWN; it cannot see what a
// screen actually draws. This snippet can, on the real page, in seconds — the
// check wave 6c runs on each screen it converts, before and after.
//
// HOW. Open a page of the web app at desktop width (≥ 900 px), open DevTools
// → Console, paste this whole file and press Enter (or save it as a Sources →
// Snippet). It changes nothing on the page. It prints one table per finding
// type and returns (and stores on window.__mageStretch) the raw findings.
// Nothing is sent anywhere.
//
// What it flags (thresholds from the wave-6b visual spec, constants/designTokens
// Layout — a control wider than these is stretched, not sized):
//   1. buttons, tabs and links wider than 480 px whose text fills < 25 % of
//      them (a 1360 px "Save" button: the label is 4 % of the box);
//   2. text inputs / textareas / selects wider than 760 px (the form column);
//   3. dialogs whose card is wider than 960 px, or whose scrim starts left of
//      the sidebar's right edge (it greys out the navigation);
//   4. horizontal overflow: the page itself, and any box whose content is
//      wider than the box (scrollWidth > clientWidth) and is not a scroller.
//
// Not a CI check: it needs a signed-in browser. Its CI counterpart is the
// orchestrator's geometry probe; this is the same measurement by hand.

/* eslint-disable no-console */
(function probeDesktopStretch() {
  'use strict';

  let LIMITS = { control: 480, textFill: 0.25, input: 760, dialog: 960 };

  function visible(el) {
    let r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    let cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0;
  }

  function label(el) {
    let t = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim();
    return t.replace(/\s+/g, ' ').slice(0, 60) || '(' + el.tagName.toLowerCase() + ')';
  }

  /** Width of the element's own text, measured with a Range (not the box). */
  function textWidth(el) {
    try {
      let range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().width;
    } catch {
      return 0;
    }
  }

  function px(n) { return Math.round(n); }

  let sidebar = document.querySelector('[aria-label="Primary navigation"]');
  let sidebarRight = sidebar && visible(sidebar) ? sidebar.getBoundingClientRect().right : 0;

  // 1. Stretched controls.
  let controls = [];
  let controlSel = 'button, [role="button"], [role="tab"], a[href], [role="link"]';
  Array.prototype.forEach.call(document.querySelectorAll(controlSel), function (el) {
    if (!visible(el)) return;
    let w = el.getBoundingClientRect().width;
    if (w <= LIMITS.control) return;
    let fill = w > 0 ? textWidth(el) / w : 1;
    if (fill >= LIMITS.textFill) return;
    controls.push({ what: el.getAttribute('role') || el.tagName.toLowerCase(), label: label(el), width: px(w), textFill: Math.round(fill * 100) + '%' });
  });

  // 2. Stretched inputs.
  let inputs = [];
  Array.prototype.forEach.call(document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select'), function (el) {
    if (!visible(el)) return;
    let w = el.getBoundingClientRect().width;
    if (w > LIMITS.input) inputs.push({ what: el.tagName.toLowerCase(), label: label(el), width: px(w) });
  });

  // 3. Dialogs: the CARD (first opaque descendant that is not the full-window
  //    scrim) and where the scrim starts.
  let dialogs = [];
  Array.prototype.forEach.call(document.querySelectorAll('[aria-modal="true"], [role="dialog"]'), function (root) {
    if (!visible(root)) return;
    let queue = [root];
    let card = null;
    let scrimLeft = null;
    let winW = window.innerWidth;
    while (queue.length && !card) {
      let n = queue.shift();
      let r = n.getBoundingClientRect();
      let bg = getComputedStyle(n).backgroundColor;
      let opaque = bg && bg !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(bg);
      let translucent = /rgba\([^)]*,\s*0?\.\d+\)$/.test(bg);
      if (opaque && translucent && scrimLeft === null) scrimLeft = r.left;
      else if (opaque && !translucent && r.width < winW - 1) card = { el: n, width: r.width };
      Array.prototype.push.apply(queue, Array.prototype.slice.call(n.children));
    }
    let problems = [];
    if (card && card.width > LIMITS.dialog) problems.push('card ' + px(card.width) + ' px > ' + LIMITS.dialog);
    if (sidebarRight > 0 && scrimLeft !== null && scrimLeft < sidebarRight - 1) problems.push('scrim covers the sidebar (starts at ' + px(scrimLeft) + ', sidebar ends at ' + px(sidebarRight) + ')');
    if (problems.length) dialogs.push({ label: label(card ? card.el : root), problems: problems.join('; ') });
  });

  // 4. Horizontal overflow.
  let overflow = [];
  let page = document.scrollingElement || document.documentElement;
  if (page.scrollWidth > page.clientWidth + 1) {
    overflow.push({ box: 'the page', clientWidth: page.clientWidth, scrollWidth: page.scrollWidth });
  }
  Array.prototype.forEach.call(document.querySelectorAll('body div'), function (el) {
    if (overflow.length > 25 || el.clientWidth < 200 || !visible(el)) return;
    if (el.scrollWidth <= el.clientWidth + 1) return;
    let ox = getComputedStyle(el).overflowX;
    if (ox === 'auto' || ox === 'scroll') return; // a real scroller, on purpose
    overflow.push({ box: label(el), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth });
  });

  let result = { viewport: window.innerWidth + '×' + window.innerHeight, sidebarRight: px(sidebarRight), controls: controls, inputs: inputs, dialogs: dialogs, overflow: overflow };
  if (window.innerWidth < 900) console.warn('[stretch] viewport is under 900 px — the desktop layout is off here; widen the window.');
  console.info('[stretch] ' + result.viewport + ' — ' + controls.length + ' stretched controls, ' + inputs.length + ' wide inputs, ' + dialogs.length + ' dialog problems, ' + overflow.length + ' overflowing boxes');
  if (controls.length) console.table(controls);
  if (inputs.length) console.table(inputs);
  if (dialogs.length) console.table(dialogs);
  if (overflow.length) console.table(overflow);
  window.__mageStretch = result;
  return result;
})();
