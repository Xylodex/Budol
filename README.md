# Budol

Find discounted products on Shopee Philippines. Budol is a Chrome and Edge extension that highlights matching listings and puts the highest advertised discounts first in a local Deals page.

Version **1.8.0** adds right-click Discord sharing and retains the discount-first workflow. The Genshin-inspired menus and blue ₱1,000 palette remain, with original local artwork and no game rewards or promotional slogans. See the [feature-by-feature UX audit](docs/UX-AUDIT.md) for what changed and why.

Version **1.7.1** fixes an uncaught error when Budol reloads while a Shopee tab remains open. The old product observer now stops cleanly; refresh Shopee to activate the updated scripts.

## Install or update

1. Extract `dist/budol.zip`, or use this project's `extension` folder.
2. Open `chrome://extensions` or `edge://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Refresh any open Shopee tabs, then pin Budol from the extensions menu.

For an existing installation, replace the files in the same loaded folder, click **Reload** on its extension card, and refresh Shopee. This preserves the existing extension's local data. Export a backup before uninstalling or moving to a different installation.

No Node.js, account, or build step is needed to use the extension.

## Find deals

1. Open a shop, category, or search listing on [Shopee Philippines](https://shopee.ph). Complete any verification normally.
2. Click Budol's toolbar icon. Set **Discount at least** with the slider or exact number field. The default is 50%; 50% and higher match.
3. Matching cards receive a blue outline and badge. Optionally turn on **Dim other products** to fade nonmatches, including cards without a readable discount. Cards remain clickable and keep their positions.
4. Choose **View deals**. Matching loaded products appear in descending advertised-discount order. Open a product through its title, or **Save to board** for later.
5. Choose another connected **Shopee tab** if needed. Scroll in that tab to load more listings, then choose **Refresh products** in Budol. **Show more products** reveals six additional matches at a time.

The threshold is shared between Deals and the popup. Uncheck **Only matching discounts** to include lower discounts and products without readable badges; unknown discounts sort last. Turning off **Discount filter** removes effects from Shopee; the Deals page still works independently.

Budol reads currently loaded listing cards. The discount is Shopee's advertised claim, not a verified saving. It does not search Shopee's entire catalog, bypass verification, or load more products automatically. Direct product-detail capture is not supported. Shopee markup changes may require an extension update.

## Send a product to Discord

Right-click a Shopee product card, image, or link and choose **Send item to Discord**. A blue message on Shopee reports sending, success, or failure; the extension badge also reports status. There is no preview step or automatic posting.

The embed contains a clickable product title, photo, listing price, advertised discount, crossed-out price, and readable rating/sold/seller/location/shipping details when available. Missing details are omitted. Product-detail pages use matching Open Graph metadata when present and otherwise share the product link with an unknown price. Budol never guesses stock, voucher eligibility, delivery dates, or variant prices.

Use **Discord settings** in the popup (or the extension's Options page) to save or replace a webhook. Saving does not send a message. Disconnect clears the saved webhook. For forum channels, add a valid thread_id query parameter. A missing webhook opens settings on the first send attempt.

This workspace's unpacked installation imports its private local setup on reload. The public ZIP excludes that setup: recipients supply their own webhook. The private file is ignored by Git and excluded from product backups. Do not share the unpacked folder containing discord-local.json; use the ZIP.

Repeated clicks are suppressed while sending and for ten seconds after a successful send from the same tab. Rate limits show a retry time. Uncertain network delivery is never retried automatically: check Discord first to avoid a duplicate.

## Save and compare later

- **Saved products:** search product names, notes, and collections; sort by newest saved, lowest price, or name. Unknown prices sort last. Collection filtering appears when you have more than one collection.
- **Collection & notes:** edit details and select **Save details**. Unsaved drafts survive filtering, refreshes, and reloads in the same tab. Save before closing the tab; drafts are temporary and not included in backups.
- **Price observations:** saved products update when their listing cards appear on pages you visit. One observation appears as a dated price; two or more show a chart and exact values. The card compares the current price with the first retained observation.
- **Cost calculator:** select **Use price**, confirm the variant price, enter quantity and shipping, and calculate. Enter 0 only when shipping is free. An optional fixed or percentage voucher supports minimum spend and a percentage cap. After the first estimate, valid edits update the total automatically. Selecting a different product resets quantity, shipping, and voucher values; **Clear calculator** resets everything.
- **Remove / Undo removal:** undo restores the most recent removal, including any draft, until another removal or page reload.
- **Backups & storage:** export your saved board as JSON. Restore previews new products before import and skips existing products so their notes and history are preserved.

These are advertised listing prices, not confirmed variant prices or complete market history. Ranges, conflicting prices, and unreadable prices remain unavailable. Confirm shipping, voucher eligibility, fees, and your final payment on Shopee. Budol does not apply vouchers or place orders.

## Storage and privacy

Budol requests `storage`, `contextMenus`, and host access to Discord for webhook delivery. Content scripts run on `https://shopee.ph` and its subdomains. Settings and up to 200 saved products are stored in this browser, with the latest 90 price observations per product. An unchanged price is recorded at most once per UTC day; observed price changes are recorded immediately.

Budol reads loaded listing cards and connected Shopee tab titles. It retains product titles, canonical links, listing prices, observation times, collections, and notes only for products you save. It does not read account details, cart contents, or purchase history, and makes no background price requests. Only an explicit Send item to Discord action uploads the selected product’s public listing details and image URL to your configured Discord webhook. Private notes, collections, saved history, and account details are excluded. The webhook token stays in local settings and the optional private setup file. Product links open Shopee normally. Backups contain your saved products and notes.

## Development

Requires Node.js 20.19 or newer. On Windows:

```powershell
npm ci
npm test
npm run check
npx playwright install chromium
npm run test:browser
npm run package
```

Packaging writes `dist/budol.zip` and extracts the extension directly into `dist`. Only public files inside `extension` are packaged; `discord-local.json` is excluded from the ZIP and copied only to the local unpacked `dist` folder. Reload the extension and refresh Shopee after updating a loaded folder.

The installed Chromium test intercepts Shopee requests with a local fixture. It exercises discovery, shared settings, capture, notes, price history, calculation, backup recovery, keyboard access, and a 320px layout. Screenshots are written to `artifacts/browser`. This is functional verification, not a claim that every live Shopee layout is supported.

To check a saved Shopee page without executing its scripts or loading its resources:

```powershell
node scripts/check-saved-page.cjs "C:\path\to\saved-shopee-page.html" 50
```

The [UI research](docs/UI-UX-RESEARCH.md) records earlier source-based design decisions. The [extension-only proposal](docs/EXTENSION-PROPOSAL.md) is a backlog of optional ideas, not the current implementation scope.
