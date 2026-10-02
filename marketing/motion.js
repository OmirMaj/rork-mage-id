/**
 * MAGE ID — marketing page helpers
 *
 * Two small jobs, nothing that moves on its own:
 * - writes the current year into #year;
 * - adds the thin scroll-progress line at the top of the page.
 *
 * Motion on the site lives in /assets/motion-kit.js (data-mk attributes).
 * Pages without JavaScript lose nothing here.
 */
(function () {
  'use strict';

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  var prog = document.querySelector('.scroll-progress');
  if (!prog) {
    prog = document.createElement('div');
    prog.className = 'scroll-progress';
    prog.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(prog, document.body.firstChild);
  }
  var setProg = function () {
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    var p = max > 0 ? h.scrollTop / max : 0;
    prog.style.transform = 'scaleX(' + p.toFixed(4) + ')';
  };
  window.addEventListener('scroll', setProg, { passive: true });
  setProg();
})();
