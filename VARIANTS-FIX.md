# Size / Colour order fix — what to do (2 minutes)

1. In **Supabase → SQL Editor → New query**, paste the full text of `supabase-variants.sql` and click **Run**.
   - Running it again is completely safe; old data and orders are not deleted.
   - At the end, the result should show `OK - variants setup complete (v2)` and `table_ready / order_function_ready / policies_ready = true`.
   - The number for `products_with_stock_mismatch` should be `0`.
2. Upload the new website files to your hosting (the whole zip).
3. Go to Admin → Dashboard and click **Run connection check**. "Order with size / colour (place_order_v3)" should show ✔.
4. Place a test order: choose size + colour → Cash on Delivery → place the order. The variant's stock should go down by 1.

## What was fixed
- Why orders with variants failed: when the product's total stock (`products.stock`) and the variants' stock did not match, the old function
  wrongly returned "out of stock". Now this mismatch is corrected automatically before an order is placed, and all products are synced as soon as you run the SQL.
- The order function is more robust: the same variant twice, invalid input, and restoring the variant stock when an order fails are all handled.
- **Safety net** in the website: if the database function fails for any reason, the customer's order is still saved and
  the address note says `[VARIANT ORDER - Hoodie (M / Red) x1 - reduce variant stock manually]`.
- Professional Size chips + Colour swatches on the product page, a clear highlight when the selection is incomplete, and the variant name in the cart/receipt/WhatsApp.

---
# Admin Orders — full details (new)

1. Run `supabase-order-details.sql` in the Supabase SQL Editor (safe, you can run it again). With this, new orders also save the email, city,
   payment method (JazzCash/EasyPaisa...), TID and screenshot.
2. Upload the new zip. In Admin → **Orders** you will now see a card for every order: customer (name, phone, email, address, city),
   payment (COD / advance, TID, screenshot), every product (picture, name, size/colour, price, qty, total), status, WhatsApp button,
   "Copy order details", search and status filter. New orders appear automatically every 1 minute (there is also a Refresh button).

---
# Search + photo slider (new)
- **Search:** if the product the customer searched for does not exist but a similar category does (for example "shoes" -> Footwear, "watch" -> Watches,
  "clothes" -> Clothing), that category (tile) and its products are shown. Even when a product is found, "Related categories" are shown at the top.
  If nothing matches, all categories are shown. No SQL needs to be run.
- **Photos:** for a product with 2 or more pictures, its card automatically shows the next picture every 3 seconds (in a loop, with dots).
  On the product page the pictures also change automatically, and you can switch them with arrows, swipe or thumbnails too.
