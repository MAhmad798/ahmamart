/* AhmaMart — Light / Dark theme switch.
   - The very first paint is already correct because of the tiny script in every page's <head> (no white flash).
   - The header button (any element with data-theme-toggle) switches the theme and the choice is remembered on this device.
   - Until the customer picks one, the site follows the phone / computer setting (light or dark). */
(function () {
  var KEY = 'ahma_theme', root = document.documentElement;
  function saved() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function current() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  function sync() {
    var dark = current() === 'dark';
    var buttons = document.querySelectorAll('[data-theme-toggle]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i], ic = b.querySelector('.ti');
      b.setAttribute('aria-pressed', dark ? 'true' : 'false');
      b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      b.title = dark ? 'Light mode' : 'Dark mode';
      if (ic) ic.textContent = dark ? '☀️' : '🌙';
    }
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#000000' : '#000000');
  }
  function apply(t, persist) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark'); else root.removeAttribute('data-theme');
    if (persist) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    sync();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-toggle]');
    if (b) apply(current() === 'dark' ? 'light' : 'dark', true);
  });
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var follow = function (e) { if (!saved()) apply(e.matches ? 'dark' : 'light', false); };
    if (mq.addEventListener) mq.addEventListener('change', follow); else if (mq.addListener) mq.addListener(follow);
  }
  window.ahmaTheme = { get: current, set: function (t) { apply(t === 'dark' ? 'dark' : 'light', true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();
