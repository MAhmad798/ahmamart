# AhmaMart — Payment setup (COD + online gateway)

The website now supports three payment methods. At the "Payment" step of checkout, the customer chooses one:

| Method | When it is shown | Setup |
|---|---|---|
| 📲 Advance (JazzCash / EasyPaisa / SadaPay) | always | already working |
| 💵 Cash on Delivery | only on small orders (up to **Rs. 3,000** by default) | Step 1 below |
| 💳 Online (PayFast: card + JazzCash + EasyPaisa) | when the gateway is turned on | Step 2 below — **needs a merchant account** |

## Step 1 — COD (5 minutes)

1. Supabase → **SQL Editor** → paste `supabase-payment-methods.sql` and click **Run**.
   This creates the `payment_method`, `payment_status` and `payment_ref` columns in the orders table, and the `place_order_v2()` function.
2. To change the COD limit, change it in **two places** (both must be the same):
   - `cod_max` in `supabase-payment-methods.sql` (then Run the SQL again)
   - `PAYMENT.cod.maxTotal` in `app.js`
3. To turn COD off: set `PAYMENT.cod.enabled = false` in `app.js`.

COD also works without running the SQL (the order is saved and `[COD - cash on delivery]` is written at the start of the address), but then the limit is enforced only in the browser. Running the SQL enforces the limit on the server as well.

In Admin → Orders, below each order's total you will see 💵 COD / 📲 Advance / 💳 Online · paid.

## Step 2 — Online gateway (PayFast)

> **This part is still untested.** It needs a PayFast (APPS) merchant account and its Merchant ID + Secured Key — I do not have those. Test on the **sandbox** first, then go live.

1. Get a PayFast merchant account (gopayfast.com) and ask for the sandbox credentials and the integration guide. A single integration covers card, JazzCash and EasyPaisa.
2. Log in with the Supabase CLI and link the project, then set the secrets:
   ```
   supabase secrets set PAYFAST_MERCHANT_ID=xxxx PAYFAST_SECURED_KEY=xxxx PAYFAST_MERCHANT_NAME=AhmaMart \
     SITE_URL=https://your-domain.pk \
     PAYFAST_WEBHOOK_URL=https://wfdedrzkqtndnqulvpos.supabase.co/functions/v1/payfast-webhook
   ```
   (If you do not set `PAYFAST_BASE`, the sandbox `https://ipguat.apps.net.pk` is used. For live, set the live host that PayFast gives you.)
3. Deploy both functions (`--no-verify-jwt` is required, because the website uses the publishable key and PayFast's server does not log in):
   ```
   supabase functions deploy payfast-create --no-verify-jwt
   supabase functions deploy payfast-webhook --no-verify-jwt
   ```
4. Set `PAYMENT.gateway.enabled = true` in `app.js`.
5. Place a test order on the sandbox. Check that the order becomes `payment_status = paid`.
   Make the **webhook's `validation_hash` formula** (`payfast-webhook/index.ts`) match PayFast's guide. If it does not match, the function will not mark anything as "paid" (this is safe), and you can confirm payments manually from the admin.
6. Before going live, set `PAYFAST_BASE` and the credentials to the live ones.

### How it works
- The order is first saved with `payment_status = unpaid`. The amount always comes from the database, never from the browser.
- `payfast-create` gets a token from PayFast and sends the customer to PayFast's payment page.
- Only `payfast-webhook` (called by PayFast's server) marks the order as `paid`. When the customer returns to the site (`?pay=success`), it only shows a message.
- If the customer abandons the payment halfway, the order stays `unpaid`. The admin can cancel it.
