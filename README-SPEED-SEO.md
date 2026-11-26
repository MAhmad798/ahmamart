# AhmaMart — Speed + SEO update (21 Nov 2026)

## How to upload
Upload the whole zip to your hosting (replace the old files). Then submit `https://ahmamart.com/sitemap.xml` in Google Search Console.

## If you change any file later
- When you change `style.css` / `app.js`, update the number `?v=20261122d` in the HTML (so that browsers fetch the new file).
- The `_source/` folder holds the **readable (non-minified)** copies of app.js / style.css / login.js. Edit them there, then minify:
  `esbuild _source/app.js --minify --outfile=app.js` (do the same for style.css and login.js).
- To change the domain, find and replace `ahmamart.com` in: robots.txt, sitemap.xml, every HTML page, app.js (`SITE_URL`), api/sitemap-products.js.

## What changed
Speed: scripts are deferred, store data starts loading from the head, Google Analytics / Meta Pixel load after the page has loaded, small WebP images, minified CSS/JS,
faster repeat visits through a service worker, cache files (vercel.json / _headers / .htaccess).
SEO: canonical + Open Graph + schema on every page, its own title/description/schema (Product, price, stock) for every product/category, H1 + text on the home page, robots.txt, sitemap.xml, api/sitemap-products.js (works on Vercel only; the products sitemap is `/sitemap-products.xml`).

## Categories (22 Nov 2026)
- Admin -> Categories: the list shows only the **main categories**. Tap one (its name or the ▸ arrow) and its sub-categories slide open; tap again to close.
  "Expand all / Collapse all" buttons are at the top. When you add a new sub-category, or drag/move one, its parent opens automatically.

## Order tracking fix (22 Nov 2026)
- "My orders" / "Track order": the phone number now works in any format (03001234567, 0300-1234567, +92 300 1234567, 3001234567).
- Run `supabase-track-orders.sql` once in Supabase (it recreates `list_customer_orders` and `track_order` with last-10-digits matching).
- Even before you run the SQL, the website tries several spellings of the number to find orders, but the SQL is the reliable fix.

## Accessibility (22 Nov 2026)
- New file `a11y.js` (loaded on every page). It provides keyboard and screen-reader support:
  a "Skip to main content" link, `role="dialog"` + `aria-modal` + a name on every popup (cart, checkout, track order, my orders, product detail...),
  focus moves inside when a popup opens, Tab cycles only within the popup, Esc closes it, focus returns to the same button when it closes,
  the closed cart drawer no longer receives Tab focus, message areas (checkout/payment/track/newsletter) are announced to screen readers,
  product cards open with Tab + Enter/Space, and "Cart: N items" is announced when the cart count changes.
- No changes were made to app.js. a11y.js watches the existing "on" class that app.js already adds to open/close popups.
- If you keep the markup of a new popup as `.modal-overlay > .modal`, it will be included automatically.
- Skip-link and focus-ring styling was added at the end of style.css. The version has been changed to `?v=20261122e`.

## Product reviews & ratings (23 Nov 2026)
**Do this once first:** Supabase -> SQL Editor -> paste `supabase-reviews.sql` and Run. (Until you run it, no review box will appear on the website, and the rest of the site will keep working normally.)
- Product page: stars + "4.7 · 3 reviews" under the title, and below it a "Customer reviews" section (average, 5-1 star bars, list of reviews, "Write a review" form).
- Product cards (home, category, "You may also like"): small stars + count, only on products that have reviews.
- Google: if there are approved reviews, aggregateRating + review are added to the product schema automatically.
- A new review is "Pending" at first. Admin panel -> **Reviews** tab -> Approve / Reject / Delete. A red badge shows the number of pending reviews.
- To show reviews immediately (without approval): change `v_status` to `'approved'` in `supabase-reviews.sql` and Run it again.
- Spam protection: a hidden honeypot field, a maximum of 5 reviews per hour from one connection, the same review cannot be submitted twice, and reviews containing web links are rejected.
- Files: `reviews.js` (new), `supabase-reviews.sql` (new), styling at the end of style.css. No changes to app.js.

## Admin Orders fix + mobile (23 Nov 2026)
- Cause: only `index.html` had the new Orders markup; the other 9 pages (product, category, about, contact, faq, policies...) still had the old Orders table. When the admin was opened from those pages, the new order cards got squeezed into the old table and looked broken. Now all pages have the same new markup.
- Admin tables (Products, Customers, Subscribers, the products inside an order): the header and rows now line up with their columns; a wide table scrolls sideways inside itself on mobile.
- Mobile/tablet: the admin menu is a single line at the top (scrolls sideways, stays fixed while scrolling), order cards take the full screen width, buttons are bigger, and filters sit on one scrolling line.
- Note: if you add a new section/field in the admin, keep it identical on all HTML pages (or open the admin only from index.html).
