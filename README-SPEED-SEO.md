# AhmaMart — Speed + SEO update (21 Nov 2026)

## Upload kaise karein
Pura zip hosting par upload karein (purani files replace). Phir Google Search Console me `https://ahmamart.com/sitemap.xml` submit karein.

## Aage koi file badlen to
- `style.css` / `app.js` badalne par HTML me `?v=20261122c` ka number badal dein (taake browser nayi file le).
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
