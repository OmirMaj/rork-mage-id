// nav-mobile.js — shared across every marketing page.
//
// Below 720px, landing.css hides .nav-links with `display: none`. Without a
// replacement, phone visitors couldn't reach pricing / features / demo /
// support from any page. This script auto-injects a hamburger toggle into
// the .nav-inner container on page load and lets the toggle expand the
// same .nav-links list as a vertical dropdown.
//
// No external dependencies. Pure DOM. Idempotent — guards against double-
// injection if the script is included twice.

(function () {
  'use strict';
  function init() {
    const navInner = document.querySelector('.nav-inner');
    if (!navInner) return;
    if (navInner.querySelector('.nav-toggle')) return; // already injected
    // Homepage markup uses `.nav-links` (landing.css); every other marketing
    // page uses `.links` (styles.css). Target both so the hamburger works
    // site-wide, not just on the homepage.
    const navLinks = navInner.querySelector('.nav-links, .links');
    if (!navLinks) return;

    const toggle = document.createElement('button');
    toggle.className = 'nav-toggle';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.type = 'button';
    toggle.innerHTML =
      '<span class="nav-toggle-bar"></span>' +
      '<span class="nav-toggle-bar"></span>' +
      '<span class="nav-toggle-bar"></span>';

    // Insert immediately before the CTA button (the right-aligned anchor)
    // so the hamburger lands left of the CTA, or at the end if there is
    // no CTA on this page.
    const cta = navInner.querySelector('.nav-cta');
    if (cta) {
      navInner.insertBefore(toggle, cta);
    } else {
      navInner.appendChild(toggle);
    }

    function setOpen(open) {
      navLinks.classList.toggle('is-open', open);
      toggle.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    toggle.addEventListener('click', function () {
      setOpen(!navLinks.classList.contains('is-open'));
    });

    // Close the menu after a link is tapped so the user lands on the new
    // page with the menu collapsed.
    navLinks.addEventListener('click', function (e) {
      const target = e.target;
      if (target && target.tagName === 'A') setOpen(false);
    });

    // Close on Escape for keyboard users.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navLinks.classList.contains('is-open')) setOpen(false);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
