# AhmaMart — SEO guide (27 Nov 2026)

No one can promise the #1 place on Google for "anything online". Ranking depends on the website **and** on things outside it (reviews, links, time).
This update makes the website technically complete for Google; the checklist below covers the part only you can do.

## What is already in the website
- **Home page:** title and description built around "Online shopping in Pakistan", a readable text block with links to the policies, FAQ and every main category, and structured data (store, address, phone, website search box).
- **Every product page:** its own title (e.g. "Buy Classic Running Shoes Online - Rs. 1,999 | AhmaMart"), description, canonical link, social-sharing image, and Product structured data with price, stock, rating (when there are reviews), **shipping time (2–5 days) and the 3-day return policy**, which helps Google show rich results.
- **Every category page:** its own title and description (it lists its sub-categories / number of products), breadcrumbs and structured data.
- **Links Google can follow:** product names on every card are real links, and the footer of every page lists the main categories.
- **Sitemaps:** `/sitemap.xml` (main pages) and `/sitemap-products.xml` (all products with their photos and all categories, updated automatically; works on Vercel).
- **robots.txt**, a 404 page (not indexed), noindex on the login page, fast loading (deferred scripts, WebP, caching) and mobile-friendly pages.

## Do this once (about 30 minutes) — this is what actually gets you listed
1. **Google Search Console** (search.google.com/search-console): add `https://ahmamart.com`, verify it, then submit both sitemaps: `sitemap.xml` and `sitemap-products.xml`. Use "URL inspection → Request indexing" for the home page and your best 5–10 products.
2. **Google Business Profile** (business.google.com): create a profile for "AhmaMart", Kasur, with phone, WhatsApp, website, categories and photos. This is what makes you appear for searches like "online store Kasur".
3. **Bing Webmaster Tools** (bing.com/webmasters): import your site from Search Console and submit the sitemaps.
4. Put the **same name, phone and address** (AhmaMart, Kasur, Punjab, 0329 6063123) on your Facebook / Instagram / TikTok pages, and link to ahmamart.com from each profile and from your WhatsApp Business profile.

## Keep doing (this is what moves you up)
- **Write a real description for every product** (at least 2–3 sentences: material, size, colour, use). A product with no description has almost nothing for Google to rank. Use the words people type, e.g. "women's running shoes", "gift box for kids".
- **Use clear product names**: "Men's Leather Sandals – Black" is better than "Item 25".
- **Upload a good photo for every product and category** (Admin → Products / Categories) and keep stock and prices up to date.
- **Collect reviews**: ask customers to review the product they bought; stars can appear next to your product in Google.
- **Get links**: share product and category links on social media, ask local pages / groups to mention you.
- Check Search Console once a week (Pages → what is indexed, Performance → which searches bring visitors) and write products/categories for those searches.
- Results take time: new sites usually need **several weeks to a few months** before pages start to rank.

## If you change the domain
Find and replace `ahmamart.com` in: robots.txt, sitemap.xml, every HTML page, app.js (`SITE_URL`) and api/sitemap-products.js.
