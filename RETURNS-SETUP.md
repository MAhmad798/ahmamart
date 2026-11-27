# AhmaMart — Order returns (hidden feature)

Customers can request a return online. The feature is **not visible on the store**: there is no menu item, button or footer link. The form lives on a hidden page and is marked `noindex`, so Google does not list it, and it is not in `sitemap.xml`.

## 1. One-time setup (required)
1. Open Supabase → **SQL Editor** → **New query**.
2. Paste the whole file **`supabase-returns.sql`** and press **Run**. You should see `OK - returns setup complete`.
   It is safe to run again. It creates the `return_requests` table, a private `return-photos` photo bucket, the secure functions the form uses, and starts recording the delivery date when you mark an order as *delivered*.
3. Upload the new/changed files to your hosting (everything in this folder).

Until step 2 is done, customers who open the form see a friendly "not available right now" message and nothing breaks.

## 2. Where customers find it
- In **Return, Refund & Cancellation** (`refund-policy.html`) there is a link: *return request form*.
- In **My orders**, orders that are *shipped* or *delivered* show a small link: *Problem with this order? Return an item*.
- You can also send customers the direct link: `https://ahmamart.com/returns.html`

## 3. What the customer does
1. Enters the **order code + phone number** used for the order (only matching orders are found).
2. Ticks the **item(s) and quantity** to return, picks a **reason**, describes the problem, confirms the **date received**, the **condition** of the item, and adds up to 4 **photos** (required for damaged / wrong / defective items).
3. Chooses **Refund / Replacement / Exchange**. For a refund: JazzCash / EasyPaisa / SadaPay / NayaPay / bank, account holder name and number.
4. Confirms their **name, phone, email and pickup address**, and submits.
5. Gets a **return code** (e.g. `RET-7KQ2MX`) and can follow progress under *Check return status* (code + phone). A pending request can be cancelled by the customer.

Rules enforced by the database: the order must be shipped/delivered, return window is **3 days** from delivery, one open request per order, spam protection (5 requests per hour, 15 failed lookups per hour per connection).

## 4. What you do (admin)
Log in to the admin panel as usual → new **Returns** tab (a red number shows pending requests).
- Each request shows customer details, order, items, reason, condition, description, refund account (with Copy button) and the photos.
- Change the **status**: Pending review → Approved → Pickup arranged → Item received → Completed (or Rejected).
- **Message to customer** is shown on their status page (pickup day, courier, refund reference…). **Private note** is only for you.
- **WhatsApp customer** opens a ready message for the current status. **Delete** removes the request and its photos.

## 5. Changing the rules
- Return window: in `supabase-returns.sql` change `c_window constant int := 3` (it appears in two functions), then run the file again. Also edit the "3 days" wording in the policy text if you change it.
- Reasons / refund methods lists: `_source/returns.js` (customer form) and the same lists inside `supabase-returns.sql`.

Files added: `returns.html`, `returns.js`, `returns-admin.js`, `supabase-returns.sql`, `RETURNS-SETUP.md`. Changed: `app.js`, `style.css`, `refund-policy.html`, cache version in all pages.
