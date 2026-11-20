# Size / Colour order fix — kya karna hai (2 minute)

1. **Supabase → SQL Editor → New query** me `supabase-variants.sql` ka poora text paste karke **Run** karein.
   - Dobara chalana bilkul safe hai, purana data/orders delete nahi hote.
   - Aakhir me result me `OK - variants setup complete (v2)` aur `table_ready / order_function_ready / policies_ready = true` aana chahiye.
   - `products_with_stock_mismatch` ka number `0` hona chahiye.
2. Naye website files hosting par upload karein (pura zip).
3. Admin → Dashboard → **Run connection check** dabayen. "Order with size / colour (place_order_v3)" ✔ hona chahiye.
4. Ek test order karein: size + colour chunein → Cash on Delivery → order place. Variant ka stock 1 kam hona chahiye.

## Kya theek hua
- Variants wale order fail hone ki wajah: product ka total stock (`products.stock`) aur variants ke stock me farq hone par purana function
  ghalat "out of stock" de deta tha. Ab order se pehle yeh farq khud theek ho jata hai, aur SQL run karte hi sab products sync ho jate hain.
- Order function mazboot: same variant do baar, ghalat input, aur fail hone par variant stock wapas — sab handle.
- Website me **safety net**: agar database function kisi wajah se kaam na kare, customer ka order phir bhi save hota hai aur
  address note me `[VARIANT ORDER - Hoodie (M / Red) x1 - reduce variant stock manually]` likha hota hai.
- Product page par professional Size chips + Colour swatches, adhoori selection par saaf highlight, cart/receipt/WhatsApp me variant ka naam.
