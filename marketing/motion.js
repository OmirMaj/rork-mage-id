/**
 * MAGE ID — marketing motion
 *
 * - IntersectionObserver for lightweight reveal-on-enter (hero + generic .reveal)
 * - GSAP ScrollTrigger for pinned pillar reveals (when available)
 * - Counter animation on the proof stat strip
 * - Magnetic cursor + blob follower for premium-feel CTAs
 * - Everything respects prefers-reduced-motion
 */

(function () {
  'use strict';

  let reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // =========================================================
  // Year stamp
  // =========================================================
  let yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // =========================================================
  // Nav scroll state
  // =========================================================
  let nav = document.querySelector('.nav');
  if (nav) {
    let onScroll = function () {
      if (window.scrollY > 10) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // =========================================================
  // Generic reveal-on-enter
  // =========================================================
  if (!reduceMotion && 'IntersectionObserver' in window) {
    let revealables = document.querySelectorAll('.reveal, .reveal-word');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealables.forEach(function (el) { io.observe(el); });

    // Sections that opt into .is-in class (for child chip reveals, etc.)
    let sectionTargets = document.querySelectorAll('.problem, .pillar');
    var sectionIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          sectionIo.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    sectionTargets.forEach(function (el) { sectionIo.observe(el); });
  } else {
    // No IO support or reduced motion — show everything
    document.querySelectorAll('.reveal, .reveal-word').forEach(function (el) {
      el.classList.add('is-in');
    });
    document.querySelectorAll('.problem, .pillar').forEach(function (el) {
      el.classList.add('is-in');
    });
  }

  // =========================================================
  // Counter animation (proof strip)
  // =========================================================
  function animateCounter(el, target, duration, prefix, suffix) {
    prefix = prefix || '';
    suffix = suffix || '';
    let start = performance.now();
    function tick(now) {
      let p = Math.min(1, (now - start) / duration);
      // ease-out cubic
      let eased = 1 - Math.pow(1 - p, 3);
      let val = Math.round(target * eased);
      el.textContent = prefix + val + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  if (!reduceMotion && 'IntersectionObserver' in window) {
    let stats = document.querySelectorAll('.stat-val');
    var statsIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        let el = entry.target;
        if (el.dataset.animated) return;
        el.dataset.animated = '1';

        let text = el.getAttribute('data-text');
        if (text) {
          el.textContent = text;
          statsIo.unobserve(el);
          return;
        }

        let target = parseInt(el.getAttribute('data-count') || '0', 10);
        let prefix = el.getAttribute('data-prefix') || '';
        let suffix = el.getAttribute('data-suffix') || '';
        animateCounter(el, target, 1400, prefix, suffix);
        statsIo.unobserve(el);
      });
    }, { threshold: 0.4 });
    stats.forEach(function (el) { statsIo.observe(el); });
  }

  // =========================================================
  // GSAP ScrollTrigger — pillar reveal + parallax mockup
  // (Only if GSAP is available — the IO fallback above already
  //  handles the base reveal if GSAP fails to load from CDN.)
  // =========================================================
  if (!reduceMotion && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);

    // Pillar mockup parallax (subtle — mockup drifts up as pillar passes)
    document.querySelectorAll('.pillar').forEach(function (pillar) {
      let mockup = pillar.querySelector('.pillar-mockup');
      if (!mockup) return;

      gsap.fromTo(mockup,
        { y: 60 },
        {
          y: -60,
          ease: 'none',
          scrollTrigger: {
            trigger: pillar,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.6
          }
        }
      );
    });

    // Hero content subtle lift on scroll
    let heroContent = document.querySelector('.hero-content');
    if (heroContent) {
      gsap.to(heroContent, {
        y: -60,
        opacity: 0.4,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero',
          start: 'top top',
          end: 'bottom top',
          scrub: 0.6
        }
      });
    }

    // Problem headline strike-through timing synced with section
    let scrub = document.querySelector('.problem .scrub-out');
    if (scrub) {
      ScrollTrigger.create({
        trigger: '.problem',
        start: 'top 60%',
        onEnter: function () {
          document.querySelector('.problem').classList.add('is-in');
        }
      });
    }
  }

  // =========================================================
  // Magnetic CTA + cursor blob
  // =========================================================
  let isFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (isFinePointer && !reduceMotion) {
    let blob = document.querySelector('.cursor-blob');
    let rafId = null;
    let mouseX = -100, mouseY = -100;
    let blobX = -100, blobY = -100;

    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      if (blob) blob.style.opacity = '0.5';
    });

    document.addEventListener('mouseleave', function () {
      if (blob) blob.style.opacity = '0';
    });

    function blobLoop() {
      blobX += (mouseX - blobX) * 0.18;
      blobY += (mouseY - blobY) * 0.18;
      if (blob) {
        blob.style.transform = 'translate(' + (blobX - 13) + 'px, ' + (blobY - 13) + 'px)';
      }
      rafId = requestAnimationFrame(blobLoop);
    }
    blobLoop();

    // Magnetic pull on .magnetic buttons
    let magnets = document.querySelectorAll('.magnetic');
    magnets.forEach(function (btn) {
      let strength = 0.28;
      let radius = 90;

      btn.addEventListener('mousemove', function (e) {
        let rect = btn.getBoundingClientRect();
        let centerX = rect.left + rect.width / 2;
        let centerY = rect.top + rect.height / 2;
        let dx = e.clientX - centerX;
        let dy = e.clientY - centerY;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < radius) {
          btn.style.transform = 'translate(' + (dx * strength) + 'px, ' + (dy * strength) + 'px)';
          if (blob) {
            blob.style.width = '60px';
            blob.style.height = '60px';
            blob.style.opacity = '0.85';
          }
        }
      });

      btn.addEventListener('mouseleave', function () {
        btn.style.transform = '';
        if (blob) {
          blob.style.width = '26px';
          blob.style.height = '26px';
          blob.style.opacity = '0.5';
        }
      });
    });
  }

  // =========================================================
  // Form: light-weight validation + success state
  // =========================================================
  // =========================================================
  // Scroll-progress hairline
  // =========================================================
  let prog = document.querySelector('.scroll-progress');
  if (!prog) {
    // Auto-inject on every page that loads motion.js (no per-page markup needed).
    prog = document.createElement('div');
    prog.className = 'scroll-progress';
    prog.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(prog, document.body.firstChild);
  }
  if (prog) {
    let setProg = function () {
      let h = document.documentElement;
      let max = h.scrollHeight - h.clientHeight;
      let p = max > 0 ? h.scrollTop / max : 0;
      prog.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    };
    window.addEventListener('scroll', setProg, { passive: true });
    setProg();
  }

  // =========================================================
  // Staggered group reveals — children animate in sequence
  // =========================================================
  ['.moat-grid', '.cta-row', '.pillar-bullets', '.hero-meta'].forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (group) {
      let kids = group.querySelectorAll('.reveal, .reveal-word, .meta-tick');
      kids.forEach(function (k, i) { k.style.setProperty('--d', String(i)); });
    });
  });

  // =========================================================
  // Tilt-on-hover for cards (desktop, fine pointer only)
  // =========================================================
  if (isFinePointer && !reduceMotion) {
    document.querySelectorAll('.moat-card, [data-tilt]').forEach(function (card) {
      card.classList.add('tilt');
      card.addEventListener('mousemove', function (e) {
        let r = card.getBoundingClientRect();
        let px = (e.clientX - r.left) / r.width - 0.5;
        let py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform = 'perspective(720px) rotateX(' + (-py * 5).toFixed(2) + 'deg) rotateY(' + (px * 6).toFixed(2) + 'deg) translateY(-4px)';
      });
      card.addEventListener('mouseleave', function () { card.style.transform = ''; });
    });
  }

  let form = document.querySelector('.cta-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      let email = form.querySelector('input[type="email"]');
      if (email && email.value && email.checkValidity()) {
        // Let Formspree handle the actual submit; flash a success affordance on click.
        let btn = form.querySelector('button');
        if (btn) {
          let label = btn.querySelector('span');
          if (label) label.textContent = 'Sending…';
        }
      }
    });
  }
})();
