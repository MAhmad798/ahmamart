/* AhmaMart product reviews + star ratings
   Needs: supabase-reviews.sql run once in Supabase (table product_reviews, view product_rating_summary, function submit_review).
   Until that SQL is run, this file quietly does nothing (no broken boxes on the site).

   Customer side
   - Product page: star summary under the title, "Customer reviews" section (average, breakdown, list, "Write a review" form)
   - Product cards (home / category / related): small stars + review count, only for products that have reviews
   - Google: aggregateRating + review added to the product's schema (only when real approved reviews exist)
   Admin side
   - New "Reviews" tab in the admin panel: Approve / Reject / Delete (new reviews are "pending" until approved)

   It reuses `sb` (the Supabase client) from app.js, so it must load after app.js (both are `defer`). */
(function () {
  'use strict';
  if (window.__ahmaReviews) return;
  window.__ahmaReviews = 1;

  var PER_PAGE = 5;

  function db() { try { return (typeof sb !== 'undefined') ? sb : null; } catch (e) { return null; } }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(s) { try { return new Date(s).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } }
  function one(n) { return (Math.round(Number(n) * 10) / 10).toFixed(1); }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }

  /* partial stars: a grey row of 5 stars with a gold overlay width */
  function stars(avg, extraLabel) {
    var a = Math.max(0, Math.min(5, Number(avg) || 0));
    return '<span class="rv-stars" style="--p:' + (a / 5 * 100) + '%" role="img" aria-label="' + one(a) + ' out of 5 stars' + (extraLabel ? ', ' + esc(extraLabel) : '') + '"><span aria-hidden="true">★★★★★</span></span>';
  }

  /* ---------- data ---------- */
  var sumMap = null, sumPromise = null;       /* product_id -> {avg, count}; null = not loaded; false = feature not installed */
  function loadSummaries() {
    if (sumPromise) return sumPromise;
    var c = db();
    if (!c) return Promise.resolve(false);
    sumPromise = Promise.resolve(c.from('product_rating_summary').select('product_id,avg_rating,review_count')).then(function (r) {
      if (r.error) { sumMap = false; return false; }
      var m = {};
      (r.data || []).forEach(function (x) { m[x.product_id] = { avg: Number(x.avg_rating), count: Number(x.review_count) }; });
      sumMap = m; return m;
    }, function () { sumMap = false; return false; });
    return sumPromise;
  }

  var rowsCache = {};
  function loadRows(pid) {
    if (rowsCache[pid]) return rowsCache[pid];
    var c = db();
    if (!c) return Promise.resolve(null);
    rowsCache[pid] = Promise.resolve(c.from('product_reviews').select('id,rating,title,body,reviewer_name,created_at')
      .eq('product_id', pid).eq('status', 'approved').order('created_at', { ascending: false }).limit(200))
      .then(function (r) { return r.error ? null : (r.data || []); }, function () { return null; });
    return rowsCache[pid];
  }

  /* ---------- product cards: small stars ---------- */
  function decorateCards() {
    if (!sumMap) return;
    Array.prototype.forEach.call(document.querySelectorAll('.card[data-open]:not([data-rv])'), function (card) {
      card.setAttribute('data-rv', '1');
      var s = sumMap[Number(card.getAttribute('data-open'))];
      if (!s || !s.count) return;
      var name = card.querySelector('.cname');
      if (!name) return;
      var d = document.createElement('div');
      d.className = 'rv-mini';
      d.innerHTML = stars(s.avg, plural(s.count, 'review')) + '<span class="rv-mini-n">' + one(s.avg) + ' (' + s.count + ')</span>';
      name.insertAdjacentElement('afterend', d);
    });
  }

  /* ---------- product page ---------- */
  function enhanceProductPage() {
    var pp = document.querySelector('#pageView .pp');
    if (!pp || pp.getAttribute('data-rv')) return;
    var h1 = pp.querySelector('.pp-info h1');
    var desc = document.querySelector('#pageView .pp-desc');
    if (!h1 || !desc) return;
    var pid = Number(new URLSearchParams(location.search).get('id'));
    if (!pid) return;
    pp.setAttribute('data-rv', '1');

    Promise.all([loadSummaries(), loadRows(pid)]).then(function (res) {
      var rows = res[1];
      if (res[0] === false || rows === null) return;               /* SQL not installed yet: show nothing */
      if (!document.documentElement.contains(pp)) return;          /* page was re-drawn meanwhile; the new draw runs this again */
      var s = (sumMap && sumMap[pid]) || summarize(rows);
      buildSection(pp, h1, desc, pid, rows, s);
      applySchema(s, rows);
    });
  }

  function summarize(rows) {
    if (!rows.length) return { avg: 0, count: 0 };
    var t = 0; rows.forEach(function (r) { t += r.rating; });
    return { avg: Math.round(t / rows.length * 10) / 10, count: rows.length };
  }

  function applySchema(s, rows) {
    if (!s || !s.count) return;
    var el = document.getElementById('ld-product');
    if (!el) return;
    var d; try { d = JSON.parse(el.textContent); } catch (e) { return; }
    var prod = (d['@graph'] || []).filter(function (x) { return x['@type'] === 'Product'; })[0];
    if (!prod) return;
    prod.aggregateRating = { '@type': 'AggregateRating', ratingValue: String(one(s.avg)), reviewCount: String(s.count), bestRating: '5', worstRating: '1' };
    prod.review = rows.slice(0, 5).map(function (r) {
      return {
        '@type': 'Review', author: { '@type': 'Person', name: r.reviewer_name }, datePublished: String(r.created_at || '').slice(0, 10),
        name: r.title || undefined, reviewBody: r.body,
        reviewRating: { '@type': 'Rating', ratingValue: String(r.rating), bestRating: '5', worstRating: '1' }
      };
    });
    el.textContent = JSON.stringify(d);
  }

  function buildSection(pp, h1, desc, pid, rows, s) {
    var sum = document.createElement('a');
    sum.className = 'rv-sum';
    sum.href = '#reviews';
    sum.innerHTML = s.count
      ? stars(s.avg, plural(s.count, 'review')) + '<span><b>' + one(s.avg) + '</b> · ' + plural(s.count, 'review') + '</span>'
      : '<span>No reviews yet · Be the first to review</span>';
    h1.insertAdjacentElement('afterend', sum);

    var dist = [0, 0, 0, 0, 0, 0];
    rows.forEach(function (r) { if (r.rating >= 1 && r.rating <= 5) dist[r.rating]++; });
    var distTotal = rows.length || 1;

    var sec = document.createElement('section');
    sec.className = 'rvw';   /* not 'rv': the site already uses .rv for its scroll-fade animation */
    sec.id = 'reviews';
    sec.setAttribute('aria-labelledby', 'rvTitle');
    sec.innerHTML =
      '<div class="rv-head"><h2 id="rvTitle" tabindex="-1">Customer reviews</h2>' +
      '<button type="button" class="rv-write" id="rvWrite" aria-expanded="false" aria-controls="rvFormWrap">✍️ Write a review</button></div>' +
      (s.count
        ? '<div class="rv-over"><div class="rv-big"><b>' + one(s.avg) + '</b>' + stars(s.avg) + '<span>' + plural(s.count, 'review') + '</span></div>' +
        '<div class="rv-bars">' + [5, 4, 3, 2, 1].map(function (n) {
          return '<div class="rv-bar"><span>' + n + ' ★</span><i><u style="width:' + Math.round(dist[n] / distTotal * 100) + '%"></u></i><span>' + dist[n] + '</span></div>';
        }).join('') + '</div></div>'
        : '<p class="rv-empty">No reviews yet. Be the first to share your experience with this product.</p>') +
      '<div id="rvFormWrap" hidden>' + formHtml() + '</div>' +
      '<ul class="rv-list" id="rvList"></ul>' +
      '<button type="button" class="rv-more" id="rvMore" hidden>Show more reviews</button>';
    desc.insertAdjacentElement('afterend', sec);

    /* list with "show more" */
    var list = sec.querySelector('#rvList'), more = sec.querySelector('#rvMore'), shown = 0;
    function renderMore() {
      var slice = rows.slice(shown, shown + PER_PAGE);
      list.insertAdjacentHTML('beforeend', slice.map(function (r) {
        return '<li class="rv-item"><div class="rv-top">' + stars(r.rating) + (r.title ? '<b>' + esc(r.title) + '</b>' : '') + '</div>' +
          '<p>' + esc(r.body) + '</p><div class="rv-by">' + esc(r.reviewer_name) + ' · ' + esc(fmtDate(r.created_at)) + '</div></li>';
      }).join(''));
      shown += slice.length;
      more.hidden = shown >= rows.length;
    }
    renderMore();
    more.addEventListener('click', renderMore);

    /* jump from the stars under the title */
    sum.addEventListener('click', function (e) {
      e.preventDefault();
      sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var t = sec.querySelector('#rvTitle'); if (t) t.focus({ preventScroll: true });
    });

    wireForm(sec, pid);
  }

  function formHtml() {
    var radios = [1, 2, 3, 4, 5].map(function (n) {
      return '<input type="radio" name="rating" id="rvr' + n + '" value="' + n + '"><label for="rvr' + n + '" title="' + n + (n === 1 ? ' star' : ' stars') + '">' +
        '<span class="sr-only">' + n + (n === 1 ? ' star' : ' stars') + '</span><span aria-hidden="true">★</span></label>';
    }).join('');
    return '<form class="rv-form" id="rvForm" novalidate>' +
      '<fieldset class="rv-rate"><legend>Your rating <span aria-hidden="true">*</span></legend><div class="rv-pick">' + radios + '</div></fieldset>' +
      '<div class="rv-f"><label for="rvName">Your name <span aria-hidden="true">*</span></label><input id="rvName" name="name" maxlength="60" autocomplete="name" required></div>' +
      '<div class="rv-f"><label for="rvTitleIn">Review title <small>(optional)</small></label><input id="rvTitleIn" name="title" maxlength="100" placeholder="e.g. Good quality, fits well"></div>' +
      '<div class="rv-f"><label for="rvBody">Your review <span aria-hidden="true">*</span></label><textarea id="rvBody" name="body" rows="4" maxlength="1500" required placeholder="What did you like or dislike? How was the quality, size and delivery?"></textarea></div>' +
      '<div class="rv-hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="rv-msg" id="rvMsg" role="status" aria-live="polite"></div>' +
      '<button type="submit" class="rv-submit">Submit review</button>' +
      '<p class="rv-note">Reviews are checked by our team before they appear. Please do not add phone numbers or web links.</p></form>';
  }

  var ERRORS = {
    rating: 'Please choose a star rating.', name: 'Please enter your name (2 to 60 letters).', body: 'Please write at least 5 characters in your review.',
    links: 'Please remove web links from your review.', duplicate: 'It looks like you already sent this review.',
    too_many: 'Too many reviews from this connection. Please try again later.', product: 'This product could not be found.'
  };

  function wireForm(sec, pid) {
    var wrap = sec.querySelector('#rvFormWrap'), btn = sec.querySelector('#rvWrite'), form = sec.querySelector('#rvForm'), msg = sec.querySelector('#rvMsg');
    var nameIn = form.elements.name;
    nameIn.value = lsGet('ahma_rv_name');

    btn.addEventListener('click', function () {
      var open = wrap.hidden;
      wrap.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var f = form.querySelector('input[name="rating"]'); if (f) f.focus(); }
    });

    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'rating') {
        var v = Number(e.target.value);
        Array.prototype.forEach.call(form.querySelectorAll('.rv-pick label'), function (l, i) { l.classList.toggle('on', i < v); });
        msg.textContent = '';
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var checked = form.querySelector('input[name="rating"]:checked');
      var rating = checked ? Number(checked.value) : 0;
      var name = nameIn.value.trim(), title = form.elements.title.value.trim(), body = form.elements.body.value.trim();
      function bad(text, field) { msg.className = 'rv-msg err'; msg.textContent = text; if (field) field.focus(); }
      if (!rating) return bad(ERRORS.rating, form.querySelector('input[name="rating"]'));
      if (name.length < 2) return bad(ERRORS.name, nameIn);
      if (body.length < 5) return bad(ERRORS.body, form.elements.body);
      var c = db();
      if (!c) return bad('Could not send your review. Please try again.');
      var submit = form.querySelector('.rv-submit');
      submit.disabled = true; submit.textContent = 'Sending…'; msg.className = 'rv-msg'; msg.textContent = '';
      Promise.resolve(c.rpc('submit_review', { p_product_id: pid, p_rating: rating, p_name: name, p_title: title || null, p_body: body, p_website: form.elements.website.value }))
        .then(function (r) {
          var d = r && r.data;
          if (r.error || !d) { bad('Could not send your review. Please try again in a moment.'); return; }
          if (d.ok === false) { bad(ERRORS[d.error] || 'Could not send your review. Please check the form and try again.'); return; }
          lsSet('ahma_rv_name', name);
          wrap.innerHTML = '<div class="rv-thanks" tabindex="-1" role="status"><b>Thank you for your review! 🎉</b><p>It will appear on this page after our team checks it.</p></div>';
          btn.hidden = true;
          var t = wrap.querySelector('.rv-thanks'); if (t) t.focus();
        }, function () { bad('Could not send your review. Please check your internet and try again.'); })
        .then(function () { if (document.documentElement.contains(submit)) { submit.disabled = false; submit.textContent = 'Submit review'; } });
    });
  }

  /* ---------- admin: Reviews tab ---------- */
  var adm = { rows: [], filter: 'pending', loaded: false };

  function productName(id) {
    try { var p = DB.products.filter(function (x) { return String(x.id) === String(id); })[0]; return p ? p.name : ('Product #' + id); } catch (e) { return 'Product #' + id; }
  }

  function setupAdmin() {
    var shell = document.getElementById('adminShell');
    if (!shell) return;
    var aside = shell.querySelector('.aside'), main = shell.querySelector('.amain'), logout = document.getElementById('adminLogout');
    if (!aside || !main || document.getElementById('tab-reviews')) return;

    var nav = document.createElement('div');
    nav.className = 'nitem'; nav.id = 'navReviews'; nav.setAttribute('role', 'button'); nav.tabIndex = 0;
    nav.innerHTML = 'Reviews <span class="rv-badge" id="rvBadge" hidden></span>';
    aside.insertBefore(nav, logout || null);

    var sec = document.createElement('section');
    sec.id = 'tab-reviews'; sec.style.display = 'none';
    sec.innerHTML = '<div class="topb"><h2>Product reviews</h2><button class="sm" type="button" id="rvAdmRefresh">↻ Refresh</button></div>' +
      '<p class="rv-adm-help">New reviews come in as <b>Pending</b>. <b>Approve</b> shows the review on the product page, <b>Reject</b> hides it, <b>Delete</b> removes it for good.</p>' +
      '<div id="rvAdmFilters" class="ord-filters"></div><div id="rvAdmList"></div>';
    main.appendChild(sec);

    function show() {
      Array.prototype.forEach.call(shell.querySelectorAll('.nitem'), function (i) { i.classList.remove('on'); });
      nav.classList.add('on');
      Array.prototype.forEach.call(main.children, function (s) { if (s.tagName === 'SECTION') s.style.display = (s === sec) ? 'block' : 'none'; });
      loadAdmin();
    }
    nav.addEventListener('click', show);
    nav.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
    /* the other tabs are switched by app.js; just make ours step aside */
    Array.prototype.forEach.call(aside.querySelectorAll('.nitem[data-tab]'), function (i) {
      i.addEventListener('click', function () { sec.style.display = 'none'; nav.classList.remove('on'); });
    });
    sec.querySelector('#rvAdmRefresh').addEventListener('click', loadAdmin);

    sec.addEventListener('click', function (e) {
      var f = e.target.closest && e.target.closest('[data-f]');
      if (f) { adm.filter = f.getAttribute('data-f'); renderAdmin(); return; }
      var b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      var id = Number(b.getAttribute('data-id')), act = b.getAttribute('data-act');
      if (act === 'delete') removeReview(id); else setStatus(id, act === 'approve' ? 'approved' : 'rejected');
    });

    /* load the pending count as soon as the admin panel opens */
    new MutationObserver(function () { if (shell.style.display && shell.style.display !== 'none' && !adm.loaded) loadAdmin(); })
      .observe(shell, { attributes: true, attributeFilter: ['style'] });
  }

  function loadAdmin() {
    var c = db(), list = document.getElementById('rvAdmList');
    if (!c || !list) return;
    adm.loaded = true;
    Promise.resolve(c.from('product_reviews').select('*').order('created_at', { ascending: false }).limit(500)).then(function (r) {
      if (r.error) {
        adm.rows = [];
        list.innerHTML = '<div class="rv-adm-empty">Could not load reviews (' + esc(r.error.message || '') + '). Run <b>supabase-reviews.sql</b> in the Supabase SQL Editor once.</div>';
        return;
      }
      adm.rows = r.data || [];
      renderAdmin();
    });
  }

  function renderAdmin() {
    var list = document.getElementById('rvAdmList'), fl = document.getElementById('rvAdmFilters'), badge = document.getElementById('rvBadge');
    if (!list || !fl) return;
    var counts = { pending: 0, approved: 0, rejected: 0 };
    adm.rows.forEach(function (r) { if (counts[r.status] != null) counts[r.status]++; });
    if (badge) { badge.textContent = counts.pending; badge.hidden = !counts.pending; }
    fl.innerHTML = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']].map(function (f) {
      var n = f[0] === 'all' ? adm.rows.length : counts[f[0]];
      return '<button type="button" class="chip' + (adm.filter === f[0] ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + ' (' + n + ')</button>';
    }).join('');
    var rows = adm.rows.filter(function (r) { return adm.filter === 'all' || r.status === adm.filter; });
    list.innerHTML = rows.length ? rows.map(function (r) {
      return '<div class="rv-adm-item st-' + esc(r.status) + '">' +
        '<div class="rv-adm-top"><a href="product.html?id=' + encodeURIComponent(r.product_id) + '" target="_blank" rel="noopener">' + esc(productName(r.product_id)) + '</a>' +
        stars(r.rating) + '<span class="rv-st">' + esc(r.status) + '</span></div>' +
        (r.title ? '<b>' + esc(r.title) + '</b>' : '') + '<p>' + esc(r.body) + '</p>' +
        '<div class="rv-by">' + esc(r.reviewer_name) + ' · ' + esc(fmtDate(r.created_at)) + '</div>' +
        '<div class="rv-adm-btns">' +
        (r.status !== 'approved' ? '<button type="button" class="sm" data-act="approve" data-id="' + r.id + '">✔ Approve</button>' : '') +
        (r.status !== 'rejected' ? '<button type="button" class="sm" data-act="reject" data-id="' + r.id + '">✖ Reject</button>' : '') +
        '<button type="button" class="sm" data-act="delete" data-id="' + r.id + '">🗑 Delete</button></div></div>';
    }).join('') : '<div class="rv-adm-empty">No ' + (adm.filter === 'all' ? '' : adm.filter + ' ') + 'reviews.</div>';
  }

  function setStatus(id, status) {
    var c = db(); if (!c) return;
    Promise.resolve(c.from('product_reviews').update({ status: status }).eq('id', id).select('id')).then(function (r) {
      if (r.error || !r.data || !r.data.length) { alert('Could not update this review. Make sure you are logged in as admin and supabase-reviews.sql has been run.'); return; }
      adm.rows.forEach(function (x) { if (x.id === id) x.status = status; });
      rowsCache = {}; sumPromise = null;
      renderAdmin();
    });
  }
  function removeReview(id) {
    if (!confirm('Delete this review permanently?')) return;
    var c = db(); if (!c) return;
    Promise.resolve(c.from('product_reviews').delete().eq('id', id).select('id')).then(function (r) {
      if (r.error || !r.data || !r.data.length) { alert('Could not delete this review. Make sure you are logged in as admin.'); return; }
      adm.rows = adm.rows.filter(function (x) { return x.id !== id; });
      rowsCache = {}; sumPromise = null;
      renderAdmin();
    });
  }

  /* ---------- start ---------- */
  function run() { decorateCards(); if (PAGE === 'product') enhanceProductPage(); }

  function init() {
    setupAdmin();
    loadSummaries().then(run);
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      (window.requestAnimationFrame || setTimeout)(function () { pending = false; run(); });
    }).observe(document.body, { childList: true, subtree: true });
    run();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
