# AhmaMart — Speed + SEO update (21 Nov 2026)

## Upload kaise karein
Pura zip hosting par upload karein (purani files replace). Phir Google Search Console me `https://ahmamart.com/sitemap.xml` submit karein.

## Aage koi file badlen to
- `style.css` / `app.js` badalne par HTML me `?v=20261122d` ka number badal dein (taake browser nayi file le).
- `_source/` folder me app.js / style.css / login.js ki **parhne wali (non-minified)** copy hai. Edit wahin karein, phir minify karein:
  `esbuild _source/app.js --minify --outfile=app.js` (style.css aur login.js ke liye bhi yehi).
- Domain badalna ho to `ahmamart.com` ko dhoondh kar badlein: robots.txt, sitemap.xml, har HTML page, app.js (`SITE_URL`), api/sitemap-products.js.

## Kya badla
Speed: scripts defer, store data head se hi load shuru, Google Analytics / Meta Pixel page load ke baad, chhoti WebP images, minified CSS/JS,
service worker se repeat visit tez, cache files (vercel.json / _headers / .htaccess).
SEO: har page par canonical + Open Graph + schema, har product/category ka apna title/description/schema (Product, price, stock),
home par H1 + text, robots.txt, sitemap.xml, api/sitemap-products.js (sirf Vercel par chalta hai; products ki sitemap `/sitemap-products.xml`).

## Categories (22 Nov 2026)
- Admin -> Categories: list me sirf **main categories** dikhti hain. Kisi par tap karein (naam ya ▸ arrow) to uski sub-categories slide hokar khulti hain, dobara tap par band.
  "Expand all / Collapse all" buttons upar hain. Naya sub-category add karne ya drag/move karne par uska parent khud khul jata hai.

## Order tracking fix (22 Nov 2026)
- "My orders" / "Track order": phone number ab kisi bhi style me chalta hai (03001234567, 0300-1234567, +92 300 1234567, 3001234567).
- Supabase me `supabase-track-orders.sql` ek baar Run karein (yeh `list_customer_orders` aur `track_order` ko last-10-digits matching ke saath dobara banati hai).
- SQL se pehle bhi website number ke kai spellings try karke orders dhoondti hai, lekin pakka hal SQL hai.

## Accessibility (22 Nov 2026)
- Nayi file `a11y.js` (har page par load hoti hai). Yeh keyboard aur screen-reader support deti hai:
  "Skip to main content" link, har popup (cart, checkout, track order, my orders, product detail...) par `role="dialog"` + `aria-modal` + naam,
  popup khulne par focus andar jata hai, Tab popup ke andar hi ghoomta hai, Esc se band hota hai, band hone par focus wapas usi button par,
  band cart drawer ab Tab me nahi aata, message areas (checkout/payment/track/newsletter) screen reader ko announce hote hain,
  product cards Tab + Enter/Space se khulte hain, cart count badalne par "Cart: N items" announce hota hai.
- app.js me koi tabdeeli nahi hui. a11y.js purane "on" class ko dekhti hai jo app.js popup kholne/band karne ke liye pehle se lagata hai.
- Naye popup ka markup `.modal-overlay > .modal` rakhein to wo khud-ba-khud is me shamil ho jayega.
- style.css ke aakhir me skip-link aur focus-ring ki styling add hui. Version `?v=20261122e` kar diya gaya hai.

## Product reviews & ratings (23 Nov 2026)
**Pehle ek baar karein:** Supabase -> SQL Editor -> `supabase-reviews.sql` paste karke Run. (Jab tak yeh nahi chalayenge, website par reviews ka koi box nazar nahi aayega, aur baaki site normal chalegi.)
- Product page: title ke neeche stars + "4.7 · 3 reviews", neeche "Customer reviews" section (average, 5-1 star bars, reviews ki list, "Write a review" form).
- Product cards (home, category, "You may also like"): chhote stars + count, sirf un products par jin ke reviews hain.
- Google: approved reviews hon to product schema me aggregateRating + review khud add ho jata hai.
- Naya review pehle "Pending" hota hai. Admin panel -> **Reviews** tab -> Approve / Reject / Delete. Pending ka lal badge dikhta hai.
- Foran dikhana ho (bina approve): `supabase-reviews.sql` me `v_status` ko `'approved'` kar ke dobara Run karein.
- Spam se bachao: chhupa honeypot field, ek connection se 1 ghante me max 5 reviews, same review dobara nahi, web links wale reject.
- Files: `reviews.js` (naya), `supabase-reviews.sql` (naya), style.css ke aakhir me styling. app.js me koi tabdeeli nahi.

## Admin Orders fix + mobile (23 Nov 2026)
- Wajah: sirf `index.html` me naya Orders markup tha; baaki 9 pages (product, category, about, contact, faq, policies...) me purana Orders table tha. Admin in pages se kholne par naye order cards purane table ke andar ghus kar kharab dikhte the. Ab sab pages me wahi naya markup hai.
- Admin tables (Products, Customers, Subscribers, order ke products) me header aur rows ki columns ab seedhi aati hain; chaura table mobile par apne andar side-ways scroll hoti hai.
- Mobile/tablet: admin ka menu upar ek line me (side-ways scroll, scroll par chipka rehta hai), order cards poori screen me, buttons bade, filters ek line me scroll.
- Note: agar aap admin me naya section/field dalen to usay sab HTML pages me ek jaisa rakhein (ya sirf index.html se admin kholein).
