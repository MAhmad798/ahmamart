# AhmaMart — Delivery charges

Every order now carries a delivery charge that depends on the customer's **city / province**, with **free delivery** once the products total reaches an amount you choose (default **Rs. 2,000**).

## 1. One-time setup (required)
1. Open Supabase → **SQL Editor** → **New query**.
2. Paste the whole file **`supabase-delivery.sql`** and press **Run**. You should see `OK - delivery charges installed`.
   It is safe to run again — your rates are kept.
3. Upload all files in this folder to your hosting.
4. Re-run **`supabase-returns.sql`** once (it now shows the order total including delivery on the return form).
5. Redeploy the edge functions that read the order total (so WhatsApp alerts and online payments use the new total):
   ```
   supabase functions deploy notify-order --no-verify-jwt
   supabase functions deploy payfast-create --no-verify-jwt
   supabase functions deploy payfast-webhook --no-verify-jwt
   ```
   (Skip the PayFast ones if you do not use online payments.)

Until step 2 is done the shop works exactly as before (no delivery charge shown) — nothing breaks.

## 2. Set your real rates
The rates installed by the SQL are **examples only**. Log in to the admin panel → **Delivery** tab and change them to your courier's real prices:
- **General** — switch delivery charges on/off, the **free delivery amount**, the rate for **other places in Pakistan**, the usual delivery time, and a note for customers abroad.
- **Province rates** — one charge + delivery time per province.
- **City rates** — a city rate wins over its province rate (e.g. Kasur Rs. 150, Lahore Rs. 200). Type the city exactly like in the address picker.
- **Try it** — enter an address and a products total to see exactly what a customer would pay.

## 3. How it works
- Delivery charge = **city rate → else province rate → else "other places" rate**. It is **FREE** when the products total is the free-delivery amount or more.
- **Cart:** a progress bar ("Add Rs. X more to get FREE delivery") and a delivery line.
- **Checkout:** as soon as the customer picks the address, the exact charge and delivery time appear, with the total. The payment step, "Amount to pay", Cash on Delivery limit, receipt, receipt image and the WhatsApp order message all use **products + delivery**.
- The charge is calculated **by the database** when the order is saved, so it cannot be changed from the browser. Orders keep the charge they were placed with, even if you change rates later.
- Order columns: `subtotal` = products, `shipping_fee` = delivery, `grand_total` = what the customer pays.
- **Outside Pakistan** the charge is "to be confirmed": the customer is told you will confirm it on WhatsApp. When you agree a price, open **Admin → Orders**, press **Set delivery charge** on that order and enter the amount — the order total, receipt and your records update.
- Admin → Orders also lets you **change the delivery charge of any order** (marked "set manually").
- Revenue, customers' totals, My orders, Track order, the return form and the WhatsApp alert to you all show the total including delivery.
- Old orders (placed before this feature) keep their total unchanged.

## 4. Things to know
- **Cash on Delivery limit** (Rs. 3,000) is checked against the total **including delivery**.
- The free-delivery amount shown in the Shipping Policy and FAQ text is written as **Rs. 2,000**. If you change the amount in Admin → Delivery, also update that text (Shipping Policy / FAQ pages and the "Free over Rs. 2,000" label on the home page tile).
- Returns: the policy page says the delivery charge is refunded only when the return is our mistake (damaged / wrong / not as described). Edit `refund-policy.html` if you prefer a different rule.
- If an order is somehow saved without a city, the standard "other places" rate is applied until the city is saved.
