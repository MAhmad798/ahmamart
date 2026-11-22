/* AhmaMart accessibility layer (keyboard + screen reader support)
   - "Skip to main content" link
   - Popups (cart drawer, checkout, track order, product detail ... every .modal-overlay) get role="dialog", aria-modal,
     a name (aria-labelledby), a Close label on the x buttons
   - Focus moves into a popup when it opens, stays inside it (Tab / Shift+Tab), Esc closes it, and focus goes back to the
     button that opened it
   - Closed cart drawer is removed from the tab order (it only slides off-screen, so it was still tabbable before)
   - Message areas (checkout / payment / track / newsletter ...) are announced by screen readers (aria-live)
   - Product cards are reachable and usable with the keyboard (Tab, Enter, Space)
   - Cart count changes are announced ("Cart: 2 items")
   This file does not change how the store works; it only adds attributes and keyboard handling.
   It watches the existing "on" class that app.js already uses to open/close popups, so app.js needs no change. */
(function () {
  'use strict';

  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  var uid = 0;
  var stack = [];          /* open popups, last = top-most: {el: overlay or drawer, dlg: the dialog element, opener: element to refocus} */
  var wasOpen = new Map(); /* popup element -> was it open at the last check */

  function isVisible(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  function focusables(root) { return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), isVisible); }
  function ensureId(el, prefix) { if (!el.id) el.id = prefix + (++uid); return el.id; }
  function isOpen(el) { return el.classList.contains('on'); }
  function safeFocus(el) { try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { } } }

  /* ---------- 1. Skip link ---------- */
  function skipTarget() {
    var pv = document.getElementById('pageView');
    if (pv && isVisible(pv)) return pv;
    var m = document.querySelector('main');
    return (m && isVisible(m)) ? m : (pv || m);
  }
  function addSkipLink() {
    if (document.querySelector('.skip-link')) return;
    var a = document.createElement('a');
    a.className = 'skip-link';
    a.href = '#main-content';
    a.textContent = 'Skip to main content';
    a.addEventListener('click', function (e) {
      var t = skipTarget();
      if (!t) return;
      e.preventDefault();
      if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
      t.focus();
      if (t.scrollIntoView) t.scrollIntoView();
    });
    document.body.insertBefore(a, document.body.firstChild);
    var m = document.querySelector('main');
    if (m && !m.id) m.id = 'main-content';
  }

  /* ---------- 2. Dialog semantics ---------- */
  function dialogOf(el) { return el.classList.contains('modal-overlay') ? el.querySelector('.modal') : el; }

  function setupDialogs() {
    Array.prototype.forEach.call(document.querySelectorAll('.modal-overlay'), function (ov) {
      var m = ov.querySelector('.modal');
      if (!m) return;
      m.setAttribute('role', 'dialog');
      m.setAttribute('aria-modal', 'true');
      m.setAttribute('tabindex', '-1');
      var h = m.querySelector('h1,h2,h3,.pd-name');
      if (h) m.setAttribute('aria-labelledby', ensureId(h, 'dlg-title-'));
      else m.setAttribute('aria-label', 'Dialog');
      wasOpen.set(ov, isOpen(ov));
    });

    var drawer = document.getElementById('cartDrawer');
    if (drawer) {
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-modal', 'true');
      drawer.setAttribute('aria-label', 'Shopping cart');
      drawer.setAttribute('tabindex', '-1');
      syncDrawer(drawer);
      wasOpen.set(drawer, isOpen(drawer));
    }
    var backdrop = document.getElementById('overlay');
    if (backdrop) backdrop.setAttribute('aria-hidden', 'true');

    Array.prototype.forEach.call(document.querySelectorAll('.mclose'), function (b) {
      if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Close');
      if (b.tagName === 'BUTTON' && !b.getAttribute('type')) b.setAttribute('type', 'button');
    });
  }

  /* closed drawer is only translated off-screen: hide it from keyboard + screen readers */
  function syncDrawer(drawer) {
    var open = isOpen(drawer);
    if (open) { drawer.removeAttribute('aria-hidden'); drawer.inert = false; drawer.removeAttribute('inert'); }
    else { drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true; drawer.setAttribute('inert', ''); }
  }

  /* ---------- 3. Focus management when popups open / close ---------- */
  function onOpen(el) {
    var dlg = dialogOf(el);
    if (!dlg) return;
    var active = document.activeElement;
    var opener = (active && active !== document.body && !el.contains(active)) ? active : null;
    stack = stack.filter(function (s) { return s.el !== el; });
    stack.push({ el: el, dlg: dlg, opener: opener });
    setTimeout(function () {
      if (!isOpen(el) || el.contains(document.activeElement) && document.activeElement !== el) return;
      var field = Array.prototype.filter.call(dlg.querySelectorAll('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea:not([disabled])'), isVisible)[0];
      safeFocus(field || dlg);
    }, 60);
  }

  function onClose(el) {
    var entry = null;
    stack = stack.filter(function (s) { if (s.el === el) { entry = s; return false; } return true; });
    if (!entry) return;
    var top = stack[stack.length - 1];
    if (top) { safeFocus(top.dlg); return; }
    var o = entry.opener;
    if (o && document.documentElement.contains(o) && isVisible(o)) safeFocus(o);
  }

  function checkState(el) {
    var now = isOpen(el), before = wasOpen.get(el);
    if (el.id === 'cartDrawer') syncDrawer(el);
    if (now === before) return;
    wasOpen.set(el, now);
    if (now) onOpen(el); else onClose(el);
  }

  function watchPopups() {
    var mo = new MutationObserver(function (records) {
      var seen = [];
      records.forEach(function (r) { if (seen.indexOf(r.target) < 0) seen.push(r.target); });
      seen.forEach(checkState);
    });
    var els = Array.prototype.slice.call(document.querySelectorAll('.modal-overlay'));
    var drawer = document.getElementById('cartDrawer');
    if (drawer) els.push(drawer);
    els.forEach(function (el) { mo.observe(el, { attributes: true, attributeFilter: ['class'] }); });
  }

  /* ---------- 4. Keyboard: Esc closes, Tab stays inside the popup, Enter/Space on product cards ---------- */
  function closeTop() {
    var top = stack[stack.length - 1];
    if (!top) return;
    var el = top.el;
    var btn = el.id === 'cartDrawer' ? document.getElementById('cartCloseBtn') : el.querySelector('.mclose');
    if (btn) btn.click();
    if (isOpen(el)) el.classList.remove('on');   /* fallback if the close button did nothing */
    if (el.id === 'cartDrawer') { var bd = document.getElementById('overlay'); if (bd) bd.classList.remove('on'); }
  }

  function onKeydown(e) {
    if (e.defaultPrevented) return;
    stack = stack.filter(function (s) { return isOpen(s.el); });
    var top = stack[stack.length - 1];

    if (e.key === 'Escape' || e.key === 'Esc') {
      if (top) { e.preventDefault(); closeTop(); }
      return;
    }

    if (e.key === 'Tab' && top) {
      var list = focusables(top.dlg);
      var active = document.activeElement;
      if (!list.length) { e.preventDefault(); safeFocus(top.dlg); return; }
      var first = list[0], last = list[list.length - 1];
      if (!top.dlg.contains(active) || active === top.dlg) {
        e.preventDefault(); safeFocus(e.shiftKey ? last : first);
      } else if (e.shiftKey && active === first) {
        e.preventDefault(); safeFocus(last);
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); safeFocus(first);
      }
      return;
    }

    /* product cards are <div>s with a click handler: let Enter / Space open them */
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') && e.target && e.target.matches && e.target.matches('.card[data-open]')) {
      e.preventDefault();
      e.target.click();
    }
  }

  /* ---------- 5. Product cards reachable by keyboard ---------- */
  function enhanceCards(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.card[data-open]'), function (c) {
      if (c.getAttribute('data-a11y')) return;
      c.setAttribute('data-a11y', '1');
      c.setAttribute('tabindex', '0');
      if (!c.getAttribute('role')) c.setAttribute('role', 'button');
      var nm = c.querySelector('.cname');
      if (nm && !c.getAttribute('aria-label')) c.setAttribute('aria-label', nm.textContent.trim() + ' - view details');
    });
  }

  /* ---------- 6. Screen reader announcements ---------- */
  var liveBox = null;
  function announce(msg) {
    if (!liveBox) return;
    liveBox.textContent = '';
    setTimeout(function () { liveBox.textContent = msg; }, 80);
  }
  function setupLive() {
    liveBox = document.createElement('div');
    liveBox.id = 'a11y-status';
    liveBox.className = 'sr-only';
    liveBox.setAttribute('role', 'status');
    liveBox.setAttribute('aria-live', 'polite');
    liveBox.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveBox);

    Array.prototype.forEach.call(document.querySelectorAll('[id$="Msg"],#emptyState'), function (el) {
      if (!el.getAttribute('aria-live')) { el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); el.setAttribute('aria-atomic', 'true'); }
    });

    var badge = document.getElementById('cartCount');
    if (badge) {
      badge.setAttribute('aria-hidden', 'true');
      var last = badge.textContent;
      new MutationObserver(function () {
        var t = badge.textContent;
        if (t === last) return;
        last = t;
        var n = parseInt(t, 10) || 0;
        announce('Cart: ' + n + (n === 1 ? ' item' : ' items'));
      }).observe(badge, { childList: true, characterData: true, subtree: true });
      var cb = document.getElementById('cartBtn');
      if (cb && !cb.getAttribute('aria-haspopup')) cb.setAttribute('aria-haspopup', 'dialog');
    }
  }

  function init() {
    addSkipLink();
    setupDialogs();
    watchPopups();
    setupLive();
    enhanceCards();
    document.addEventListener('keydown', onKeydown);

    /* cards are drawn by app.js after the page loads, so watch for new ones */
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      (window.requestAnimationFrame || setTimeout)(function () { pending = false; enhanceCards(); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
