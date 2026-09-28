/* growth.js (T6, ES5): allow-listed ?ref= (= utils/growthLink.ts list) goes
   to PostHog once, to the session, and onto app.mageid.app links, now and on
   click. Never reads document.referrer. */
(function () {
  var SURFACES = ['portal', 'shared_estimate', 'shared_photos', 'pay_link', 'lien_waiver', 'bid_invite', 'sub_portal', 'prequal', 'builders', 'email'];
  var KEY = 'mageid_growth_ref';
  function allowed(v) {
    v = String(v || '').toLowerCase();
    for (var i = 0; i < SURFACES.length; i++) if (SURFACES[i] === v) return v;
    return null;
  }
  function fromSearch(search) {
    var m = /[?&]ref=([^&#]*)/.exec(search || '');
    if (!m) return null;
    try { return allowed(decodeURIComponent(m[1])); } catch (e) { return null; }
  }
  function decorate(href, ref) {
    var m = /^(https:\/\/app\.mageid\.app)(\/[^?#]*)?(\?[^#]*)?(#.*)?$/i.exec(href || '');
    if (!m) return href;
    var q = m[3] || '';
    if (/[?&]ref=/.test(q)) return href;
    return m[1] + (m[2] || '/') + (q ? q + '&' : '?') + 'ref=' + ref + (m[4] || '');
  }
  var ref = fromSearch(window.location.search);
  try {
    if (ref) window.sessionStorage.setItem(KEY, ref);
    else ref = allowed(window.sessionStorage.getItem(KEY));
  } catch (e) { /* storage blocked */ }
  if (!ref) return;
  try { if (window.posthog && window.posthog.register_once) window.posthog.register_once({ growth_ref: ref }); } catch (e) {}
  function fix(a) {
    var h = a.getAttribute('href'), n = decorate(h, ref);
    if (n !== h) a.setAttribute('href', n);
  }
  var links = document.getElementsByTagName('a');
  for (var i = 0; i < links.length; i++) fix(links[i]);
  function onClick(e) {
    var t = e && e.target;
    while (t && String(t.tagName).toUpperCase() !== 'A') t = t.parentNode;
    if (t && t.getAttribute) fix(t);
  }
  try { document.addEventListener('click', onClick, true); document.addEventListener('auxclick', onClick, true); } catch (e) {}
})();
