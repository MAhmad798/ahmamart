# AhmaMart — Payment setup (COD + online gateway)

Website ab teen tareeqe support karti hai. Checkout ke "Payment" step par customer chunta hai:

| Tareeqa | Kab dikhta hai | Setup |
|---|---|---|
| 📲 Advance (JazzCash / EasyPaisa / SadaPay) | hamesha | pehle se chal raha hai |
| 💵 Cash on Delivery | sirf chhote orders par (default **Rs. 3,000** tak) | neeche Step 1 |
| 💳 Online (PayFast: card + JazzCash + EasyPaisa) | jab gateway on ho | neeche Step 2 — **merchant account chahiye** |

## Step 1 — COD (5 minute)

1. Supabase → **SQL Editor** → `supabase-payment-methods.sql` paste karke **Run**.
   Yeh orders table me `payment_method`, `payment_status`, `payment_ref` columns aur `place_order_v2()` function banata hai.
2. COD ki limit badalni ho to **do jagah** badlein (dono same hon):
   - `supabase-payment-methods.sql` me `cod_max` (phir SQL dobara Run)
   - `app.js` me `PAYMENT.cod.maxTotal`
3. COD band karna ho: `app.js` me `PAYMENT.cod.enabled = false`.

SQL run kiye baghair bhi COD chalta hai (order save hota hai aur address ke shuru me `[COD - cash on delivery]` likha aata hai), lekin limit sirf browser me lagti hai. SQL run karne se limit server par bhi lagti hai.

Admin → Orders me har order ke total ke neeche 💵 COD / 📲 Advance / 💳 Online · paid dikhta hai.

## Step 2 — Online gateway (PayFast)

> **Yeh hissa abhi untested hai.** Iske liye PayFast (APPS) ka merchant account aur uski Merchant ID + Secured Key chahiye — woh mere paas nahi hain. Pehle **sandbox** par test karein, phir live karein.

1. PayFast merchant account banwayen (gopayfast.com) aur sandbox credentials + integration guide len. Ek hi integration se card, JazzCash aur EasyPaisa teeno chalte hain.
2. Supabase CLI se login karke project link karein, phir secrets set karein:
   ```
   supabase secrets set PAYFAST_MERCHANT_ID=xxxx PAYFAST_SECURED_KEY=xxxx PAYFAST_MERCHANT_NAME=AhmaMart \
     SITE_URL=https://aapka-domain.pk \
     PAYFAST_WEBHOOK_URL=https://wfdedrzkqtndnqulvpos.supabase.co/functions/v1/payfast-webhook
   ```
   (`PAYFAST_BASE` na dein to sandbox `https://ipguat.apps.net.pk` use hota hai. Live par PayFast ka diya hua live host set karein.)
3. Dono functions deploy karein (`--no-verify-jwt` zaroori hai, kyun ke website publishable key use karti hai aur PayFast ka server login nahi karta):
   ```
   supabase functions deploy payfast-create --no-verify-jwt
   supabase functions deploy payfast-webhook --no-verify-jwt
   ```
4. `app.js` me `PAYMENT.gateway.enabled = true` karein.
5. Sandbox me ek test order karein. Check karein ke order `payment_status = paid` ho jata hai.
   **Webhook ka `validation_hash` formula** (`payfast-webhook/index.ts`) PayFast ki guide se match karwa lein. Agar match na hua to function kuch bhi "paid" mark nahi karega (safe), aur aap admin se manually confirm kar sakte hain.
6. Live jane se pehle `PAYFAST_BASE` aur credentials live wale set karein.

### Kaise kaam karta hai
- Order pehle `payment_status = unpaid` se save hota hai. Rakam hamesha database se aati hai, browser se nahi.
- `payfast-create` PayFast se token leta hai aur customer ko PayFast ke payment page par bhejta hai.
- Sirf `payfast-webhook` (PayFast server ki taraf se) order ko `paid` karta hai. Customer ka wapas aana (`?pay=success`) sirf ek message dikhata hai.
- Agar customer payment adhoori chhor de, order `unpaid` rehta hai. Admin use cancel kar sakta hai.
