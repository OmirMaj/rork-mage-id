/*!
 * MAGE ID — Instant Estimate widget
 * https://mageid.app/widget/
 *
 * A contractor drops ONE script tag on their own website:
 *
 *   <script src="https://mageid.app/widget/embed.js"
 *           data-mage-contractor="your-company-slug" defer></script>
 *
 * ...and a homeowner gets a ballpark price range in ten seconds, on the
 * contractor's own domain, while the lead lands in their MAGE pipeline.
 *
 * Design constraints, because this runs on somebody else's website:
 *   - Zero dependencies. No jQuery, no polyfills, no CDN calls.
 *   - Exactly ONE global: window.MageInstantEstimate. Everything else is
 *     closed over inside the IIFE.
 *   - Renders into a Shadow DOM so the host page's CSS cannot break us and
 *     our CSS cannot break the host page. Graceful fallback for the handful
 *     of browsers without attachShadow.
 *   - Never throws into the host page. Every entry point is try/caught.
 *   - No analytics. We do not get to install trackers on a customer's site.
 *
 * The pricing itself is NOT done here — it lives in the widget-estimate edge
 * function, so the model can be corrected without every contractor having to
 * re-paste a snippet. This file is a form, a fetch and a renderer.
 */
;(function () {
  'use strict';

  var VERSION = 1;
  if (window.MageInstantEstimate && window.MageInstantEstimate.version) return;

  // Captured at parse time — document.currentScript is only valid here.
  var SELF = document.currentScript || null;

  var DEFAULT_API = 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/widget-estimate';
  var SITE = 'https://mageid.app';
  var ATTRIB = SITE + '/?utm_source=instant-estimate-widget&utm_medium=embed&utm_campaign=powered-by';

  /* Mirrors the catalog the edge function returns from GET /widget-estimate.
   * Inlined so the form renders instantly with no round-trip; the edge
   * function is still the authority on price. */
  var PROJECT_TYPES = [
    { id: 'kitchen_remodel', label: 'Kitchen remodel', measure: 'kitchen floor area', typical: 180 },
    { id: 'bathroom_remodel', label: 'Bathroom remodel', measure: 'bathroom floor area', typical: 60 },
    { id: 'whole_home_remodel', label: 'Whole-home remodel', measure: 'area being remodeled', typical: 2000 },
    { id: 'home_addition', label: 'Home addition', measure: 'new conditioned area', typical: 600 },
    { id: 'new_construction', label: 'New home construction', measure: 'conditioned area', typical: 2400 },
    { id: 'adu', label: 'ADU / garage conversion', measure: 'ADU floor area', typical: 700 },
    { id: 'basement_finish', label: 'Basement finish', measure: 'basement floor area', typical: 900 },
    { id: 'deck_patio', label: 'Deck or patio', measure: 'deck / patio area', typical: 350 },
    { id: 'roof_replacement', label: 'Roof replacement', measure: 'roof area', typical: 2200 },
    { id: 'siding_replacement', label: 'Siding replacement', measure: 'wall area being resided', typical: 1800 },
    { id: 'flooring', label: 'Flooring replacement', measure: 'floor area', typical: 900 },
    { id: 'commercial_ti', label: 'Commercial tenant improvement', measure: 'leased area', typical: 3000 }
  ];

  var QUALITIES = [
    { id: 'budget', label: 'Budget — stock finishes' },
    { id: 'standard', label: 'Standard — mid-range finishes' },
    { id: 'premium', label: 'Premium — high-end finishes' },
    { id: 'luxury', label: 'Luxury — fully custom' }
  ];

  /* Every selector is .mie-* prefixed so the fallback (no Shadow DOM) path is
   * still safe to drop on any site. Palette matches mageid.app. */
  var CSS = [
    ':host{all:initial;display:block}',
    '.mie-root{',
    '  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    '  color:#1c2530;line-height:1.5;font-size:15px;text-align:left;',
    '  background:#fff;border:1px solid #E8DFCD;border-radius:16px;padding:22px;',
    '  box-shadow:0 1px 2px rgba(11,13,16,.04),0 8px 24px rgba(11,13,16,.06);',
    '  max-width:460px;box-sizing:border-box;',
    '}',
    '.mie-root *{box-sizing:border-box;margin:0;padding:0;font-family:inherit}',
    '.mie-head{margin-bottom:16px}',
    '.mie-title{font-size:19px;font-weight:700;color:#14181D;letter-spacing:-.01em;line-height:1.25}',
    '.mie-sub{font-size:13.5px;color:#5b6775;margin-top:5px}',
    '.mie-field{margin-bottom:13px}',
    '.mie-label{display:block;font-size:12.5px;font-weight:600;color:#0B0D10;margin-bottom:5px}',
    '.mie-hint{font-size:12px;color:#5b6775;font-weight:400;margin-left:4px}',
    '.mie-input,.mie-select{',
    '  width:100%;font-size:15px;font-weight:500;color:#1c2530;background:#fff;appearance:none;',
    '  padding:11px 12px;border:1.5px solid #E8DFCD;border-radius:10px;line-height:1.3;',
    '}',
    '.mie-select{background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'8\'%3E%3Cpath d=\'M1 1l5 5 5-5\' stroke=\'%235b6775\' stroke-width=\'1.8\' fill=\'none\' stroke-linecap=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px}',
    '.mie-input:focus,.mie-select:focus{outline:none;border-color:var(--mie-accent);box-shadow:0 0 0 3px rgba(0,0,0,.06)}',
    '.mie-row{display:flex;gap:10px}',
    '.mie-row>*{flex:1;min-width:0}',
    '.mie-btn{',
    '  width:100%;border:0;cursor:pointer;font-size:15px;font-weight:700;color:#fff;',
    '  background:var(--mie-accent);padding:13px 16px;border-radius:10px;margin-top:4px;',
    '  -webkit-appearance:none;',
    '}',
    '.mie-btn:hover{filter:brightness(1.06)}',
    '.mie-btn[disabled]{opacity:.55;cursor:default;filter:none}',
    '.mie-btn-ghost{background:transparent;color:#5b6775;font-weight:600;font-size:13px;padding:9px;margin-top:8px;border-radius:8px}',
    '.mie-btn-ghost:hover{color:#0B0D10;filter:none}',
    '.mie-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important}',
    '.mie-err{background:#FFF1E6;border-left:4px solid var(--mie-accent);border-radius:8px;padding:11px 13px;font-size:13.5px;color:#14181D;margin-bottom:12px}',
    '.mie-result{text-align:center}',
    '.mie-band{background:#0B0D10;border-radius:12px;padding:20px 16px;color:#fff;margin-bottom:14px}',
    '.mie-band .mie-cap{font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.72}',
    '.mie-band .mie-range{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:6px 0 4px;line-height:1.1}',
    '.mie-band .mie-likely{font-size:13px;opacity:.85}',
    '.mie-band .mie-likely b{color:var(--mie-accent);font-weight:700}',
    '.mie-chip{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;',
    '  padding:4px 9px;border-radius:999px;background:#FAF7F0;border:1px solid #E8DFCD;color:#5b6775;margin-bottom:12px}',
    '.mie-notes{text-align:left;border:1px solid #E8DFCD;border-radius:10px;overflow:hidden;margin-bottom:12px}',
    '.mie-notes summary{cursor:pointer;padding:11px 13px;font-size:13px;font-weight:600;color:#0B0D10;list-style:none;background:#FAF7F0}',
    '.mie-notes summary::-webkit-details-marker{display:none}',
    '.mie-notes summary::after{content:"+";float:right;color:var(--mie-accent);font-weight:800}',
    '.mie-notes[open] summary::after{content:"\\2013"}',
    '.mie-notes ul{padding:10px 15px 12px 28px}',
    '.mie-notes li{font-size:12.5px;color:#5b6775;margin-bottom:6px;line-height:1.45}',
    '.mie-sent{font-size:13.5px;color:#1c2530;background:#FAF7F0;border:1px solid #E8DFCD;border-radius:10px;padding:11px 13px;margin-bottom:12px}',
    '.mie-foot{margin-top:14px;padding-top:12px;border-top:1px solid #E8DFCD;text-align:center}',
    '.mie-foot a{font-size:11.5px;font-weight:600;color:#5b6775;text-decoration:none;letter-spacing:.02em}',
    '.mie-foot a:hover{color:#0B0D10}',
    '.mie-foot .mie-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--mie-accent);margin-right:6px;vertical-align:middle}',
    '.mie-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:mie-spin .7s linear infinite;vertical-align:-2px;margin-right:7px}',
    '@keyframes mie-spin{to{transform:rotate(360deg)}}',
    '@media (max-width:400px){.mie-row{display:block}.mie-row>*{margin-bottom:13px}.mie-band .mie-range{font-size:25px}}'
  ].join('\n');

  // ── tiny helpers ─────────────────────────────────────────────────────────

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') n.textContent = String(v);
        else if (k === 'html') n.innerHTML = String(v);
        else n.setAttribute(k, String(v));
      }
    }
    if (kids) for (var i = 0; i < kids.length; i++) if (kids[i]) n.appendChild(kids[i]);
    return n;
  }

  function money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function attr(node, name, fallback) {
    if (!node || !node.getAttribute) return fallback;
    var v = node.getAttribute(name);
    return v === null || v === '' ? fallback : v;
  }

  // ── the widget ───────────────────────────────────────────────────────────

  function render(root, cfg) {
    var state = { step: 1, busy: false, data: {}, result: null, error: null, sent: false };
    var wrap = el('div', { class: 'mie-root' });
    wrap.style.setProperty('--mie-accent', cfg.accent);
    root.appendChild(wrap);

    function q(sel) { return wrap.querySelector(sel); }

    function head(title, sub) {
      return el('div', { class: 'mie-head' }, [
        el('div', { class: 'mie-title', text: title }),
        sub ? el('div', { class: 'mie-sub', text: sub }) : null
      ]);
    }

    function footer() {
      return el('div', { class: 'mie-foot' }, [
        el('a', {
          href: ATTRIB, target: '_blank', rel: 'noopener noreferrer',
          html: '<span class="mie-dot"></span>Powered by MAGE ID'
        })
      ]);
    }

    function field(labelText, hint, control) {
      return el('div', { class: 'mie-field' }, [
        el('label', { class: 'mie-label', for: control.id },
          hint ? [document.createTextNode(labelText), el('span', { class: 'mie-hint', text: hint })]
               : [document.createTextNode(labelText)]),
        control
      ]);
    }

    function errBox() {
      return state.error ? el('div', { class: 'mie-err', text: state.error }) : null;
    }

    // Step 1 — the project.
    function stepScope() {
      var sel = el('select', { class: 'mie-select', id: 'mie-type' },
        [el('option', { value: '', text: 'Choose a project…' })].concat(
          PROJECT_TYPES.map(function (p) {
            return el('option', { value: p.id, text: p.label, selected: state.data.projectType === p.id });
          })
        ));
      var size = el('input', {
        class: 'mie-input', id: 'mie-size', type: 'number', inputmode: 'numeric',
        min: '1', step: '10', placeholder: 'e.g. 180', value: state.data.sizeSqft || ''
      });
      var zip = el('input', {
        class: 'mie-input', id: 'mie-zip', type: 'text', inputmode: 'numeric',
        maxlength: '10', placeholder: 'e.g. 30301', value: state.data.zip || '', autocomplete: 'postal-code'
      });
      var qual = el('select', { class: 'mie-select', id: 'mie-quality' },
        QUALITIES.map(function (o) {
          return el('option', { value: o.id, text: o.label, selected: (state.data.quality || 'standard') === o.id });
        }));

      var sizeField = field('Approximate size', ' (sq ft)', size);
      var next = el('button', { class: 'mie-btn', type: 'button', text: cfg.demo ? 'See the estimate' : cfg.cta });

      // Relabel the size field to whatever that scope actually measures, so
      // nobody types their whole house's square footage for a bathroom.
      sel.addEventListener('change', function () {
        var picked = PROJECT_TYPES.filter(function (p) { return p.id === sel.value; })[0];
        var lbl = sizeField.querySelector('.mie-label');
        if (!lbl || !lbl.firstChild) return;
        if (picked) {
          lbl.firstChild.nodeValue = picked.measure.charAt(0).toUpperCase() + picked.measure.slice(1);
          size.placeholder = 'e.g. ' + picked.typical;
        } else {
          lbl.firstChild.nodeValue = 'Approximate size';
          size.placeholder = 'e.g. 180';
        }
      });

      next.addEventListener('click', function () {
        // Save first, validate second — a redraw rebuilds these fields from
        // state, so anything not saved would be wiped by a validation error.
        state.data.projectType = sel.value;
        state.data.sizeSqft = size.value ? Number(size.value) : null;
        state.data.zip = zip.value.trim();
        state.data.quality = qual.value;
        if (!sel.value) { state.error = 'Pick a project type so we know what to price.'; return draw(); }
        state.error = null;
        // Demo mode (the docs page) prices for real but never asks a stranger
        // for their details on behalf of a contractor who doesn't exist.
        if (cfg.demo) { submit(); return; }
        state.step = 2;
        draw();
      });

      return el('div', {}, [
        head(cfg.title, cfg.subtitle),
        errBox(),
        field('What are you planning?', null, sel),
        el('div', { class: 'mie-row' }, [
          sizeField,
          field('ZIP code', null, zip)
        ]),
        field('Finish level', null, qual),
        next,
        footer()
      ]);
    }

    // Step 2 — who to send it to. One network call, at the end, with everything.
    function stepContact() {
      var name = el('input', { class: 'mie-input', id: 'mie-name', type: 'text', placeholder: 'Your name', autocomplete: 'name', value: state.data.name || '' });
      var email = el('input', { class: 'mie-input', id: 'mie-email', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', value: state.data.email || '' });
      var phone = el('input', { class: 'mie-input', id: 'mie-phone', type: 'tel', placeholder: 'Optional', autocomplete: 'tel', value: state.data.phone || '' });
      // Honeypot — same convention as the public-lead-intake function.
      var pot = el('input', { class: 'mie-hp', id: 'mie-company_website', type: 'text', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true' });
      var go = el('button', { class: 'mie-btn', type: 'button', text: 'Show my estimate' });
      var back = el('button', { class: 'mie-btn mie-btn-ghost', type: 'button', text: '← Change project details' });

      back.addEventListener('click', function () { state.error = null; state.step = 1; draw(); });

      go.addEventListener('click', function () {
        // Save first, validate second (see stepScope) — nobody should have to
        // retype their email because they forgot their name.
        state.data.name = name.value.trim();
        state.data.email = email.value.trim();
        state.data.phone = phone.value.trim();
        state.data.company_website = pot.value;
        if (!state.data.name) { state.error = 'Add your name so ' + cfg.contractorName + ' knows who to reply to.'; return draw(); }
        if (!state.data.email && !state.data.phone) { state.error = 'Add an email or a phone number.'; return draw(); }
        state.error = null;
        submit();
      });

      return el('div', {}, [
        head('Where should we send it?', 'Your ballpark appears on the next screen — we send a copy to ' + cfg.contractorName + ' so they can follow up.'),
        errBox(),
        field('Name', null, name),
        field('Email', null, email),
        field('Phone', ' (optional)', phone),
        pot,
        go,
        back,
        footer()
      ]);
    }

    // Step 3 — the number.
    function stepResult() {
      var e = state.result || {};
      if (!e.priceable || !e.range) {
        return el('div', { class: 'mie-result' }, [
          head("We couldn't put a number on this one", null),
          el('div', { class: 'mie-err', text: e.cannotPriceReason || 'That scope is outside what an instant estimate can cover.' }),
          el('div', { class: 'mie-sent', text: cfg.demo
            ? 'On your site, this visitor would still land in your pipeline — an unpriceable scope is often the most interesting lead you get all week.'
            : state.sent
              ? 'Your details went to ' + cfg.contractorName + ' — they will follow up with a real quote.'
              : 'Reach out to ' + cfg.contractorName + ' directly and they can price it properly.' }),
          el('button', { class: 'mie-btn mie-btn-ghost', type: 'button', text: 'Start over', id: 'mie-restart' }),
          footer()
        ]);
      }

      var notes = el('details', { class: 'mie-notes' }, [
        el('summary', { text: 'What this number assumes' }),
        el('ul', {}, (e.assumptions || []).map(function (a) { return el('li', { text: a }); }))
      ]);

      var confLabel = { high: 'Ballpark', medium: 'Rough ballpark', low: 'Very rough ballpark' }[e.confidence] || 'Ballpark';

      return el('div', { class: 'mie-result' }, [
        el('div', { class: 'mie-chip', text: confLabel + ' · ' + (e.projectLabel || 'Project') }),
        el('div', { class: 'mie-band' }, [
          el('div', { class: 'mie-cap', text: 'Estimated range' }),
          el('div', { class: 'mie-range', text: money(e.range.low) + ' – ' + money(e.range.high) }),
          el('div', { class: 'mie-likely', html: 'Most projects like this land around <b>' + money(e.range.likely) + '</b>' })
        ]),
        notes,
        el('div', { class: 'mie-sent', text: cfg.demo
          ? 'This is the live engine — a real call to the real endpoint. On your own site, the visitor enters their name and email before this screen, and the lead is already in your pipeline by the time they read it.'
          : state.sent
            ? 'Sent to ' + cfg.contractorName + '. They will reach out with a real quote built around your actual scope.'
            : 'We could not reach ' + cfg.contractorName + " just now — get in touch with them directly and bring this number with you." }),
        el('button', { class: 'mie-btn mie-btn-ghost', type: 'button', text: 'Estimate another project', id: 'mie-restart' }),
        footer()
      ]);
    }

    function stepBusy() {
      return el('div', {}, [
        head(cfg.title, null),
        el('button', { class: 'mie-btn', type: 'button', disabled: 'disabled', html: '<span class="mie-spin"></span>Working out your range…' }),
        footer()
      ]);
    }

    function submit() {
      // Where a failure drops the visitor back to — the last screen they filled in.
      var backStep = cfg.demo ? 1 : 2;
      state.busy = true;
      state.step = 3;
      draw();
      var payload = {
        contractorId: cfg.contractorId,
        projectType: state.data.projectType,
        sizeSqft: state.data.sizeSqft,
        quality: state.data.quality,
        zip: state.data.zip,
        name: state.data.name,
        email: state.data.email,
        phone: state.data.phone,
        company_website: state.data.company_website || ''
      };
      var done = function (result, sent, error) {
        state.busy = false;
        state.result = result;
        state.sent = !!sent;
        state.error = error || null;
        draw();
      };
      try {
        fetch(cfg.api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function (r) {
          return r.json().then(function (j) { return { status: r.status, body: j }; });
        }).then(function (res) {
          if (res.status >= 400 || !res.body || !res.body.estimate) {
            state.step = backStep;
            return done(null, false, (res.body && res.body.error) || 'Something went wrong. Try again in a moment.');
          }
          done(res.body.estimate, res.body.leadCaptured, null);
        }).catch(function () {
          state.step = backStep;
          done(null, false, 'Could not reach the estimator. Check your connection and try again.');
        });
      } catch (err) {
        state.step = backStep;
        done(null, false, 'Could not reach the estimator.');
      }
    }

    function draw() {
      wrap.textContent = '';
      var view;
      if (state.step === 3 && state.busy) view = stepBusy();
      else if (state.step === 3) view = stepResult();
      else if (state.step === 2) view = stepContact();
      else view = stepScope();
      wrap.appendChild(view);
      var restart = q('#mie-restart');
      if (restart) restart.addEventListener('click', function () {
        state.step = 1; state.result = null; state.error = null; state.sent = false; draw();
      });
      // Trigger the size-hint update for a pre-selected type.
      var typeSel = q('#mie-type');
      if (typeSel && typeSel.value) typeSel.dispatchEvent(new Event('change'));
    }

    draw();
  }

  /** Mount into any element. Returns the element, or null if it bailed. */
  function mount(target, options) {
    try {
      var host = typeof target === 'string' ? document.querySelector(target) : target;
      if (!host || host.getAttribute('data-mie-mounted') === '1') return null;
      var opts = options || {};

      var cfg = {
        contractorId: opts.contractorId || attr(host, 'data-mage-contractor', ''),
        contractorName: opts.contractorName || attr(host, 'data-mage-name', 'us'),
        accent: opts.accent || attr(host, 'data-mage-accent', '#FF6A1A'),
        title: opts.title || attr(host, 'data-mage-title', 'Get an instant ballpark'),
        subtitle: opts.subtitle || attr(host, 'data-mage-subtitle', 'A few details and you will see a real price range in seconds. No obligation.'),
        cta: opts.cta || attr(host, 'data-mage-cta', 'Continue'),
        api: opts.api || attr(host, 'data-mage-api', DEFAULT_API),
        // Demo mode: price for real, but skip lead capture. Used by the docs
        // page at mageid.app/widget/ so a live demo never harvests contacts.
        demo: !!(opts.demo || attr(host, 'data-mage-demo', ''))
      };

      host.setAttribute('data-mie-mounted', '1');

      var root;
      if (host.attachShadow) {
        var shadow = host.attachShadow({ mode: 'open' });
        var style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);
        root = shadow;
      } else {
        // No Shadow DOM: inject the sheet once. Every selector is .mie-*
        // prefixed, so the blast radius on the host page is nil.
        if (!document.getElementById('mage-instant-estimate-css')) {
          var s = document.createElement('style');
          s.id = 'mage-instant-estimate-css';
          s.textContent = CSS.replace(':host{all:initial;display:block}', '');
          document.head.appendChild(s);
        }
        root = host;
      }

      if (!cfg.contractorId) {
        var warn = el('div', { class: 'mie-root' }, [
          el('div', { class: 'mie-err', text: 'MAGE ID Instant Estimate: add data-mage-contractor="your-company-slug" to the embed snippet.' })
        ]);
        root.appendChild(warn);
        if (window.console && console.warn) console.warn('[MAGE ID] Instant Estimate: missing data-mage-contractor.');
        return host;
      }

      render(root, cfg);
      return host;
    } catch (err) {
      if (window.console && console.error) console.error('[MAGE ID] Instant Estimate failed to mount:', err);
      return null;
    }
  }

  /**
   * Auto-mount. In priority order:
   *   1. every [data-mage-estimate] element on the page (explicit placement)
   *   2. the element named by the script tag's data-mage-target selector
   *   3. a container injected right after the script tag itself
   */
  function boot() {
    try {
      var found = document.querySelectorAll('[data-mage-estimate]');
      var script = SELF || document.querySelector('script[data-mage-contractor]');
      var shared = script
        ? {
            contractorId: attr(script, 'data-mage-contractor', ''),
            contractorName: attr(script, 'data-mage-name', 'us'),
            accent: attr(script, 'data-mage-accent', '#FF6A1A'),
            title: attr(script, 'data-mage-title', 'Get an instant ballpark'),
            subtitle: attr(script, 'data-mage-subtitle', 'A few details and you will see a real price range in seconds. No obligation.'),
            cta: attr(script, 'data-mage-cta', 'Continue'),
            api: attr(script, 'data-mage-api', DEFAULT_API),
            demo: attr(script, 'data-mage-demo', '')
          }
        : {};

      if (found.length) {
        for (var i = 0; i < found.length; i++) {
          // Per-element data-* attributes win over the script tag's.
          mount(found[i], {
            contractorId: attr(found[i], 'data-mage-contractor', shared.contractorId),
            contractorName: attr(found[i], 'data-mage-name', shared.contractorName),
            accent: attr(found[i], 'data-mage-accent', shared.accent),
            title: attr(found[i], 'data-mage-title', shared.title),
            subtitle: attr(found[i], 'data-mage-subtitle', shared.subtitle),
            cta: attr(found[i], 'data-mage-cta', shared.cta),
            api: attr(found[i], 'data-mage-api', shared.api),
            demo: attr(found[i], 'data-mage-demo', shared.demo)
          });
        }
        return;
      }

      var targetSel = script ? attr(script, 'data-mage-target', null) : null;
      if (targetSel) { mount(targetSel, shared); return; }

      if (script && script.parentNode) {
        var slot = document.createElement('div');
        slot.setAttribute('data-mage-estimate', '');
        script.parentNode.insertBefore(slot, script.nextSibling);
        mount(slot, shared);
      }
    } catch (err) {
      if (window.console && console.error) console.error('[MAGE ID] Instant Estimate boot failed:', err);
    }
  }

  window.MageInstantEstimate = {
    version: VERSION,
    mount: mount,
    projectTypes: PROJECT_TYPES.slice(),
    qualities: QUALITIES.slice()
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
