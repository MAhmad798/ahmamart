# AhmaMart — WhatsApp notification for new orders

Whenever a customer places an order on the website, a message will arrive instantly on your WhatsApp number (default: **0329 6063123**, which is set in the site):

```
🛒 New order — AhmaMart
Code: ABC123
Time: 23 Nov 2026, 3:40 am

👤 Ali Khan
📞 0300 1234567  (https://wa.me/923001234567)
📍 House 5, Street 2, Kasur

Items:
• Product name x2 — Rs. 2,000

💰 Total: Rs. 2,000
Payment: 💵 Cash on Delivery
```

This happens **on the server**, not in the customer's browser — so the message arrives even if the customer closes the tab.
No website file (app.js etc.) had to be changed. There are three things: one SQL, one function, and one WhatsApp method.

---

## Step 1 — SQL (2 minutes)
Supabase → **SQL Editor** → paste `supabase-whatsapp-notify.sql` and click **Run**.
(The result should show `trigger_ready = true` and `pg_net_ready = true`.)

## Step 2 — Choose a WhatsApp method

### Method A — CallMeBot (free, easiest, works only for your own number) ✅ use this to start
CallMeBot is a free third-party service that sends messages to your own number. (It is not an official WhatsApp service, so for serious or high-volume use Method B is better.)

1. Open https://www.callmebot.com/blog/free-api-whatsapp-messages/ — it lists CallMeBot's **current WhatsApp number** (this number changes from time to time). Save it as a contact on your phone.
2. From the WhatsApp number where you want the alerts, send this message to that contact:
   `I allow callmebot to send me messages`
3. In reply you will receive an **API key** (if it does not arrive within 2 minutes, try again after 24 hours).

### Method B — Official WhatsApp Cloud API (Meta)
You need a business account, a token and an approved **template** (because a business can send the first message only with a template).
1. From Meta for Developers → WhatsApp → API Setup, get the **Phone number ID** and a (permanent) **access token**.
2. In Message Templates, create a template whose body contains only `{{1}}` (for example: `New order: {{1}}`), with the category Utility. Wait for it to be approved.
3. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` and `WHATSAPP_TEMPLATE` in the secrets below.

## Step 3 — Deploy the function
Using the Supabase CLI (as in PAYMENTS-SETUP.md), after linking the project:

```
supabase secrets set CALLMEBOT_APIKEY=your_api_key NOTIFY_SECRET=some_long_random_word
supabase functions deploy notify-order --no-verify-jwt
```

(`--no-verify-jwt` is required because the database trigger calls the function without logging in.)

For Method B, use this instead of `CALLMEBOT_APIKEY`:
```
supabase secrets set WHATSAPP_TOKEN=xxxx WHATSAPP_PHONE_ID=xxxx WHATSAPP_TEMPLATE=your_template_name
```

If you want the alert on a different number, set `NOTIFY_TO=923001234567` (with the country code, without the +). The default is the number that is set in your site.
(With CallMeBot, it must be the same number that got the key in Step 2.)

> Don't want to use the CLI? Supabase Dashboard → **Edge Functions** → *Deploy a new function* → name it `notify-order` → paste the code from `supabase/functions/notify-order/index.ts` → turn **Verify JWT off**. Secrets: Edge Functions → *Secrets*.

## Step 4 — Test
Open this link in a browser (put in your own project and `NOTIFY_SECRET`):
```
https://wfdedrzkqtndnqulvpos.supabase.co/functions/v1/notify-order?test=your_NOTIFY_SECRET
```
You should receive "✅ AhmaMart: WhatsApp order alerts are working." on WhatsApp. Then place one small real test order to check.

## If the message does not arrive
- Supabase → Edge Functions → `notify-order` → **Logs**: next to `SEND FAILED` the reason is written (wrong API key, wrong number, template not approved...).
- In Supabase → Table editor → `orders`, if `wa_notified_at` is empty, the message was not sent (if an error happens, it is cleared automatically). If it is filled in, the message was sent.
- The order is still always saved — a notification error never blocks a customer's order.

## Important points
- The message is sent **about 4 seconds after** the order is saved (so that the TID/screenshot/email can be included too). To change this, use the secret `NOTIFY_DELAY_MS`.
- For **Online (PayFast)** orders, the message arrives as soon as the order is created, with payment status `unpaid` — the webhook confirms "paid" later, and no separate message is sent for that.
- Messages are sent only for **new** orders (when you run the SQL, old orders are marked "notified").
- The function takes only the order code and sends a message only once per order, so nobody from outside can spam you by opening this link again and again.
