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
