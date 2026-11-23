# AhmaMart — Naye order par WhatsApp notification

Jab bhi koi customer website par order karega, aap ke WhatsApp number (default: **0329 6063123**, jo site me hai) par foran ek message aayega:

```
🛒 Naya order — AhmaMart
Code: ABC123
Waqt: 23 Nov 2026, 3:40 am

👤 Ali Khan
📞 0300 1234567  (https://wa.me/923001234567)
📍 House 5, Street 2, Kasur

Items:
• Product name x2 — Rs. 2,000

💰 Total: Rs. 2,000
Payment: 💵 Cash on Delivery
```

Yeh **server se** hota hai, customer ke browser par nahi chalta — is liye customer tab band kar de tab bhi message aata hai.
Website ki koi file (app.js wagera) badalni nahi padi. Teen cheezen hain: ek SQL, ek function, aur WhatsApp ka ek tareeqa.

---

## Step 1 — SQL (2 minute)
Supabase → **SQL Editor** → `supabase-whatsapp-notify.sql` paste karke **Run**.
(Natija me `trigger_ready = true` aur `pg_net_ready = true` aana chahiye.)

## Step 2 — WhatsApp ka tareeqa chunein

### Tareeqa A — CallMeBot (free, sab se aasan, sirf apne number par) ✅ shuru ke liye yehi
CallMeBot ek free third-party service hai jo aap ko aap ke apne number par message bhejti hai. (Official WhatsApp service nahi hai, is liye serious/bare volume ke liye Tareeqa B behtar hai.)

1. https://www.callmebot.com/blog/free-api-whatsapp-messages/ kholein — wahan CallMeBot ka **abhi ka WhatsApp number** likha hota hai (yeh number kabhi kabhi badalta hai). Usay phone me contact save karein.
2. Aap ke us WhatsApp number se (jis par alerts chahiye) us contact ko yeh message bhejein:
   `I allow callmebot to send me messages`
3. Jawab me aap ko ek **API key** milegi (2 minute tak na aaye to 24 ghante baad dobara try karein).

### Tareeqa B — Official WhatsApp Cloud API (Meta)
Business account, token aur ek approved **template** chahiye (kyun ke business pehla message sirf template se bhej sakta hai).
1. Meta for Developers → WhatsApp → API Setup se **Phone number ID** aur (permanent) **access token** lein.
2. Message Templates me ek template banayen, jis ki body me sirf `{{1}}` ho (jaise: `Naya order: {{1}}`), category Utility. Approve hone ka intezar karein.
3. Neeche secrets me `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE` set karein.

## Step 3 — Function deploy karna
Supabase CLI se (jaise PAYMENTS-SETUP.md me hai), project link karke:

```
supabase secrets set CALLMEBOT_APIKEY=aap_ki_api_key NOTIFY_SECRET=koi_lamba_random_lafz
supabase functions deploy notify-order --no-verify-jwt
```

(`--no-verify-jwt` zaroori hai kyun ke database trigger login ke baghair call karta hai.)

Tareeqa B ke liye `CALLMEBOT_APIKEY` ki jagah:
```
supabase secrets set WHATSAPP_TOKEN=xxxx WHATSAPP_PHONE_ID=xxxx WHATSAPP_TEMPLATE=aap_ka_template_naam
```

Alert kisi aur number par chahiye ho to `NOTIFY_TO=923001234567` (country code ke saath, + ke baghair) set karein. Default aap ka site wala number hai.
(CallMeBot me wohi number hona chahiye jis ne Step 2 me key li thi.)

> CLI nahi chalani? Supabase Dashboard → **Edge Functions** → *Deploy a new function* → naam `notify-order` → `supabase/functions/notify-order/index.ts` ka code paste karein → **Verify JWT band** karein. Secrets: Edge Functions → *Secrets*.

## Step 4 — Test
Browser me yeh link kholein (apna project aur `NOTIFY_SECRET` daal kar):
```
https://wfdedrzkqtndnqulvpos.supabase.co/functions/v1/notify-order?test=aap_ka_NOTIFY_SECRET
```
WhatsApp par "✅ AhmaMart: WhatsApp order alerts theek chal rahe hain." aana chahiye. Phir ek chhota asli test order karke dekh lein.

## Agar message na aaye
- Supabase → Edge Functions → `notify-order` → **Logs**: `SEND FAILED` ke saath wajah likhi hoti hai (galat API key, galat number, template approve nahi...).
- Order Supabase → Table editor → `orders` me `wa_notified_at` khali hai to message bheja nahi gaya (galti ki surat me khud khali kar diya jata hai). Bhar jaye to bhej diya gaya.
- Order phir bhi hamesha save hota hai — notification ki galti se customer ka order kabhi nahi rukta.

## Zaroori baatein
- Message order save hone ke **~4 second baad** jata hai (taake TID/screenshot/email bhi shamil ho sakein). Badalna ho to secret `NOTIFY_DELAY_MS`.
- **Online (PayFast)** orders par message order banate hi aata hai, payment status `unpaid` ke saath — "paid" ka confirm webhook baad me karta hai, uska alag message nahi aata.
- Sirf **naye** orders par message aata hai (SQL chalate waqt purane orders "notified" mark ho jate hain).
- Function sirf order ka code leti hai aur har order sirf ek baar message bhejti hai, is liye koi bahar se is link ko bar bar chala kar aap ko spam nahi kar sakta.
