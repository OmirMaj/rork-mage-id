/* protect-notice.js — shared by the no-account pages (client portal, sub
 * portal, bid invite, lien waiver, architect, paid). PROTECT-TEXT, 2026-10-09.
 *
 * Each of those pages carries the Notice To Recipients as STATIC markup near
 * the top of <body> (so it shows with this file blocked or still loading):
 *
 *   <aside class="mg-notice" data-recipient-notice="1"> ... </aside>
 *
 * This file does three small things for all six:
 *
 *   1. Fills the company name into every [data-notice-company] once the page
 *      knows it: window.mageNotice.setCompany('Smith Builders'). Until then
 *      the markup says "your contractor".
 *   2. Styles the notice and the skip link, and gives every focusable control
 *      a visible focus ring. Several page stylesheets remove the outline
 *      (outline: none) with no replacement; this rule wins over them.
 *   3. Names form fields that have no label. A field with a <label for>, an
 *      aria-label or an aria-labelledby is left alone. Any other field takes
 *      its name from the label text just before it, or from its placeholder.
 *      This runs again whenever the page draws new fields.
 *
 * The wording itself is NOT in this file. It is in the pages, and
 * scripts/validate-protections.ts pins every page to utils/recipientNotice.ts.
 * No network, no storage, no cookies.
 */
(function () {
  'use strict';
  if (window.mageNotice) return;

  var CSS = [
    '.mg-skip{position:absolute;left:8px;top:-60px;z-index:10000;background:#0B0D10;color:#FFFFFF;',
    'padding:10px 14px;border-radius:8px;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;text-decoration:none}',
    '.mg-skip:focus{top:8px}',
    '.mg-notice{box-sizing:border-box;width:100%;margin:0;padding:12px 16px;background:#F4F5F2;color:#0B0D10;',
    'border-bottom:1px solid #C9CDC6;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;text-align:left}',
    '.mg-notice p{margin:0 auto;max-width:960px;color:#0B0D10;font-size:14px;line-height:1.5}',
    '.mg-notice p+p{margin-top:4px}',
    '.mg-notice a{color:#1F4D29;font-weight:600;text-decoration:underline}',
    /* A visible focus ring everywhere, for keyboard users. !important on
       purpose: it has to beat the page rules that set outline:none. */
    'a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,',
    'summary:focus-visible,[tabindex]:focus-visible,[role="button"]:focus-visible,[role="link"]:focus-visible',
    '{outline:3px solid #1F4D29 !important;outline-offset:2px !important}',
    '@media print{.mg-skip{display:none}.mg-notice{border-bottom:1px solid #0B0D10;background:#FFFFFF}}'
  ].join('');

  function addCss() {
    if (document.getElementById('mg-notice-css')) return;
    var st = document.createElement('style');
    st.id = 'mg-notice-css';
    st.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(st);
  }

  var company = '';
  function paintCompany() {
    if (!company) return;
    var nodes = document.querySelectorAll('[data-notice-company]');
    /* Write only when the text differs. Setting textContent always swaps the
       text node, which the observer below sees as a change; an unconditional
       write would repaint every 60ms for as long as the page is open. */
    for (var i = 0; i < nodes.length; i++) if (nodes[i].textContent !== company) nodes[i].textContent = company;
  }
  function setCompany(name) {
    var c = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
    /* MAGE ID is never the author of a contractor's page. */
    if (!c || /^mage\s*id$/i.test(c)) return;
    company = c;
    try { paintCompany(); } catch (e) { /* never break the page that called us */ }
  }

  /* ── Field names ─────────────────────────────────────────────────────── */
  function textOf(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim() : '';
  }
  function hasName(el) {
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) return true;
    if (el.id) {
      try { if (document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]')) return true; } catch (e) { /* odd id */ }
    }
    var p = el.parentNode;
    while (p && p.nodeType === 1) { if (p.tagName === 'LABEL') return true; p = p.parentNode; }
    return false;
  }
  function nameFor(el) {
    /* The label-like element just before the field, in its own row or the row above. */
    var prev = el.previousElementSibling;
    var hops = 0;
    while (prev && hops < 2) {
      if (/^(LABEL|SPAN|DIV|P|H2|H3|H4)$/.test(prev.tagName) && !prev.querySelector('input,select,textarea,button')) {
        var t = textOf(prev);
        if (t && t.length <= 80) return t;
      }
      prev = prev.previousElementSibling; hops++;
    }
    var parent = el.parentNode;
    if (parent && parent.previousElementSibling && /^(LABEL|SPAN|DIV|P)$/.test(parent.previousElementSibling.tagName)
        && !parent.previousElementSibling.querySelector('input,select,textarea,button')) {
      var t2 = textOf(parent.previousElementSibling);
      if (t2 && t2.length <= 80) return t2;
    }
    var ph = el.getAttribute('placeholder');
    if (ph && !/^[•.\s\d,\-\/]+$/.test(ph)) return ph;
    if (el.type === 'file') return 'Attach a file';
    return '';
  }
  function nameFields(root) {
    var fields = (root || document).querySelectorAll('input:not([type="hidden"]),select,textarea');
    for (var i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (hasName(el)) continue;
      var n = nameFor(el);
      if (n) el.setAttribute('aria-label', n);
    }
    /* A meaningful image with no alt at all is announced by its file name.
       Give it an empty alt; pages set a real one where the picture carries meaning. */
    var imgs = (root || document).querySelectorAll('img:not([alt])');
    for (var j = 0; j < imgs.length; j++) imgs[j].setAttribute('alt', '');
  }

  var queued = false;
  function queueNaming() {
    if (queued) return;
    queued = true;
    setTimeout(function () {
      queued = false;
      try { nameFields(document); paintCompany(); } catch (e) { /* naming is a nicety */ }
    }, 60);
  }

  function start() {
    try {
      addCss();
      nameFields(document);
      paintCompany();
      if (window.MutationObserver && document.body) {
        new MutationObserver(queueNaming).observe(document.body, { childList: true, subtree: true });
      }
    } catch (e) { /* the notice is static markup; the page works without this file */ }
  }

  window.mageNotice = {
    setCompany: setCompany,
    nameFields: function (root) { try { nameFields(root); } catch (e) { /* naming is a nicety */ } }
  };
  try { addCss(); } catch (e) { /* see start() */ }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
