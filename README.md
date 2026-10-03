# Budol

Find discounted products on Shopee Philippines. Budol is a Chrome and Edge extension that highlights matching listings and puts the highest advertised discounts first in a local Deals page.

Version **1.11.0** adds a local **Codex MCP** connector with nine tools for reading loaded deals/offers, saved observations and alerts, estimating costs, and optional saves/removal/Discord sharing. Run `npm ci` then `npm run mcp:setup -- --register` from the full repository. Reload Budol, open **Discord settings → Codex MCP**, and connect. See [MCP setup, tools and access controls](docs/MCP.md).

Version **1.10.0** adds **Offers shown** to Deals, Saved and Compare: vouchers, shipping, Coins/cashback, bundles, add-ons, Flash Deals, payment/channel offers and campaign claims. It keeps captured conditions separate from listing prices and includes them in Discord shares and exports. See the [Shopee promotion research and limits](docs/SHOPEE-PROMOTIONS.md).

Version **1.9.0** adds listing ranges, keyword/budget/rating/sales filters, observed price watches, a four-product comparison, and CSV export. The Genshin-inspired menus and blue ₱1,000 palette remain, with original local artwork. The [implementation plan](docs/IMPLEMENTATION-PLAN-1.9.md) records scope; the [GitHub research](docs/GITHUB-FEATURE-RESEARCH.md) records the projects that informed it. No external repository code was copied.

Version **1.9.1** fixes delivery and refresh races, preserves watch/variant drafts, validates ambiguous sales counts, and recovers from damaged alert entries. See the [edge-case audit](docs/EDGE-CASE-AUDIT.md) for coverage and limits.

Version **1.7.1** fixes an uncaught error when Budol reloads while a Shopee tab remains open. The old product observer now stops cleanly; refresh Shopee to activate the updated scripts.

## Install or update

1. Extract `dist/budol.zip`, or use this project's `extension` folder.
2. Open `chrome://extensions` or `edge://extensions` and turn on **Developer mode**.
3. Choose **Load unpacked** and select the folder containing `manifest.json`.
4. Refresh any open Shopee tabs, then pin Budol from the extensions menu.

For an existing installation, replace the files in the same loaded folder, click **Reload** on its extension card, and refresh Shopee. This preserves the existing extension's local data. Export a backup before uninstalling or moving to a different installation.

No Node.js, account, or build step is needed for normal extension use. The optional MCP integration requires Node.js and the full repository.

## Find deals

1. Open a shop, category, or search listing on [Shopee Philippines](https://shopee.ph). Complete any verification normally.
2. Click Budol's toolbar icon. Set **Discount at least** with the slider or exact number field. The default is 50%; 50% and higher match.
3. Matching cards receive a blue outline and badge. Optionally turn on **Dim other products** to fade nonmatches, including cards without a readable discount. Cards remain clickable and keep their positions.
4. Choose **View deals**. Matching loaded products appear in descending advertised-discount order. Open a product through its title, or **Save to board** for later.
5. Choose another connected **Shopee tab** if needed. Scroll in that tab to load more listings, then choose **Refresh products** in Budol. **Show more products** reveals six additional matches at a time.

The threshold is shared between Deals and the popup. Uncheck **Only matching discounts** to include lower discounts and products without readable badges; unknown discounts sort last. Turning off **Discount filter** removes effects from Shopee; the Deals page still works independently.

Open **Filter products** for required/excluded keywords (comma-separated), maximum PHP price, minimum rating, and minimum sold count. Every required keyword must appear in the title. Choose whether a range's starting price or its entire range must fit your budget. Unknown values fail active numeric filters. These filters apply to the loaded Deals list; the popup's highlighter still uses the discount threshold.

**Export filtered deals (CSV)** downloads every match, including cards beyond the first six. It includes canonical links, price/range bounds, advertised discounts, available listing metadata and capture time. Text is quoted, UTF-8 encoded, and protected against formula-leading spreadsheet cells. Notes and webhook settings are excluded. Use JSON backups to restore saved products; CSV is for analysis.

Budol reads currently loaded listing cards. The discount is Shopee's advertised claim, not a verified saving. It does not search Shopee's entire catalog, bypass verification, or load more products automatically. Deals and saved observations come from listing cards; right-click sharing has a limited product-page reader. Shopee markup changes may require an extension update.

Open **Offers shown** on a product for its captured promotion wording, minimum spend, caps and restrictions. Eligibility remains unverified; benefits are never automatically stacked or deducted from the listing price. Coins are later rewards and shipping benefits stay separate. Prices explicitly labelled “after voucher” are excluded from budget matches and watches. An uncaptured offer may still exist on Shopee. CSV and JSON include this evidence.

## Send a product to Discord

Right-click a Shopee product card, image, or link and choose **Send item to Discord**. A blue message on Shopee reports sending, success, or failure; the extension badge also reports status. This action sends immediately. Automatic price alerts require separate opt-in on each saved product's watch.

The embed contains a clickable product title, photo, listing price, advertised discount, crossed-out price, and readable rating/sold/seller/location/shipping details when available. It also includes up to six captured offers with eligibility unverified. Missing details are omitted. Product-detail pages use matching Open Graph metadata and bounded public promotion rows near the product title when present; otherwise they share the product link with an unknown price. Budol never guesses stock, voucher eligibility, delivery dates, or variant prices.

Use **Discord settings** in the popup (or the extension's Options page) to save or replace a webhook. Saving does not send a message. Disconnect clears the saved webhook. For forum channels, add a valid thread_id query parameter. A missing webhook opens settings on the first send attempt.

This workspace's unpacked installation imports its private local setup on reload. The public ZIP excludes that setup: recipients supply their own webhook. Private setup files are ignored by Git and excluded from product backups. Do not share an unpacked folder containing discord-local.json or mcp-local.json; use the ZIP.

Repeated clicks are suppressed while sending and for ten seconds after a successful send from the same tab. Rate limits show a retry time. Uncertain network delivery is never retried automatically: check Discord first to avoid a duplicate.

## Save and compare later

- **Saved products:** search product names, notes, and collections; sort by newest saved, lowest price, or name. Unknown prices sort last. Collection filtering appears when you have more than one collection.
- **Collection & notes:** edit details and select **Save details**. Unsaved drafts survive filtering, refreshes, and reloads in the same tab. Save before closing the tab; drafts are temporary and not included in backups.
- **Price observations:** saved products update when their listing cards appear on pages you visit. One observation appears as a dated price; two or more show a chart and exact values. The card compares the current price with the first retained observation.
- **Listing ranges:** explicit ranges retain both bounds in a separate dated history. They never enter single-price history. **Variant for estimates** stores a manually confirmed option name and price with its own date; recheck before buying. This is not automatic variant tracking.
- **Watch and variant drafts:** unsaved input survives filters, refreshes and reloads in the same tab. Save or discard explicitly. Drafts are temporary and excluded from backups; automatic Discord posting still requires saving the watch.
- **Compare:** add up to four products from Deals or Saved. The shortlist retains snapshots and input values while you filter or change sources, until you clear it or reload the board. Compare listing/variant prices, observed lows, available rating/sales/seller/origin and dates. Enter shipping and an eligible fixed voucher for each one-item estimate. Blank shipping stays unknown. Remove and re-add an item to refresh its snapshot.
- **Cost calculator:** select **Use price**, confirm the variant price, enter quantity and shipping, and calculate. Enter 0 only when shipping is free. An optional fixed or percentage voucher supports minimum spend and a percentage cap. After the first estimate, valid edits update the total automatically. Selecting a different product resets quantity, shipping, and voucher values; **Clear calculator** resets everything.
- **Remove / Undo removal:** undo restores the most recent removal, including any draft, until another removal or page reload.
- **Backups & storage:** export your saved board as JSON. Restore previews new products before import and skips existing products so their notes and history are preserved.

These are advertised listing prices, not complete market history. Conflicting and unreadable prices remain unavailable. Confirm shipping, voucher eligibility, fees, and your final payment on Shopee. Budol does not apply vouchers or place orders.

## Price watches

On a saved product, open **Set a price watch**, choose a target PHP price or **New observed low**, then save. Pause/resume by changing **Pause watch** and saving. Watches react only to later, readable single listing prices on Shopee pages you visit. There are no scheduled price requests. Ranges and manual variant prices never trigger watches; changing variants or listing conditions can still affect advertised prices.

Matches appear in **Price alerts** (latest 100) and browser notifications if the operating system permits them. Clicking a notification opens the inbox. Each product has a 24-hour cooldown and cannot repeat its last alerted price. A new low is compared with retained single-price history.

To send matches to Discord, configure a webhook in settings and explicitly enable **Also send matching prices to my Discord webhook** on that watch. Claims are saved before delivery; a failed or uncertain send is shown in the inbox and never retried automatically, including after extension restart. Slow sends do not block board editing. Pausing, removing or changing a watch stops its queued delivery; a request already dispatched to Discord cannot be recalled. Clearing alert history also cancels queued entries. Check Discord before manually resending. Backups retain watch settings, but importing always pauses new watches and disables their Discord delivery. Existing saved products remain unchanged.

## Storage and privacy

Budol requests `storage`, `contextMenus`, `notifications`, and host access to Discord for webhook delivery. Content scripts run on `https://shopee.ph` and its subdomains. Settings and up to 200 saved products are stored in this browser, with the latest 90 single-price and 90 range observations per product. An unchanged price is recorded at most once per UTC day; observed price changes are recorded immediately.

Budol reads loaded listing cards and connected Shopee tab titles. Saved products retain public listing evidence, observations, manually entered variant references, watch settings, collections, and notes. The local alert inbox retains snapshots from triggered watches until cleared or evicted. It does not read account details, cart contents, or purchase history, and makes no background price requests. An explicit **Send item to Discord** action or an opted-in watch uploads public listing details and an available image URL to your configured webhook. Private notes, collections, saved history, and account details are excluded. The webhook token stays in local settings and the optional private setup file. Product links open Shopee normally. Backups contain your saved products, notes, manual variant references and watches, but exclude webhook tokens and the alert inbox.

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

The installed Chromium test intercepts Shopee requests with a local fixture. It exercises discovery, filters, sharing setup, notes, price history, watches, comparison, CSV and JSON downloads, calculation, backup recovery, keyboard access, and a 320px layout. Discord delivery is tested with mocks; no real test messages are posted. Screenshots are written to `artifacts/browser`. This is functional verification, not a claim that every live Shopee layout is supported.

To check a saved Shopee page without executing its scripts or loading its resources:

```powershell
node scripts/check-saved-page.cjs "C:\path\to\saved-shopee-page.html" 50
```

The [UI research](docs/UI-UX-RESEARCH.md) records earlier source-based design decisions. The [extension-only proposal](docs/EXTENSION-PROPOSAL.md) is a backlog of optional ideas, not the current implementation scope.
