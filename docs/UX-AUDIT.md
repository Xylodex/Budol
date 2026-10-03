# Budol 1.7 — UX and feature audit

2 October 2026. Primary job, chosen by the user: **find discounted products quickly**. Keep the extension-only architecture and Genshin-inspired blue peso styling. Visual ornament should not introduce game rules, rewards, or extra shopping steps.

This pass reviews implemented journeys and recovery paths using code inspection, existing UI research, DOM tests, and an installed Chromium walkthrough with intercepted Shopee fixtures. These are design judgments, not measured shopper behavior or a recruited usability study.

## Main journey

Shopee listing → Budol popup → minimum discount → View deals → highest advertised discounts → open the product on Shopee. Saving is optional. Deals is the first navigation item and starts expanded, including when products are already saved.

Previously, discovery offered products in page order without displaying or applying the popup's threshold. Discovery now shares that threshold, displays readable discounts, excludes nonmatches by default, and sorts highest first. Unknown or conflicting discounts never count as matches. Advertised discounts are transient; they are not persisted as current claims on saved products.

## Feature decisions

| Feature | Decision | Result and reason |
| --- | --- | --- |
| Popup | Simplify | View deals is the main action. Exact threshold and slider remain; the redundant 25/50/75 presets are removed. Shared settings align Deals, popup, and Shopee highlights. |
| Highlight toggle | Keep | Remove page styling immediately without changing the threshold or shortlist. |
| Focus mode | Rename and simplify | Dim other products describes its effect. Nonmatches fade to 55% opacity without blur, remain clickable, and recover their appearance when disabled. |
| Source selection | Repair | Connected Shopee tabs show page titles and product counts. Switching is explicit. Refresh recovers when the original source closes. No extra permission. |
| Discount discovery | Promote | Rank matching loaded products by percentage. Titles open Shopee directly; saving is optional. Reveal six additional products at a time without a nested scrolling list. |
| No matching deals | Repair | Explain the empty state and offer Show all loaded products. Users can also lower the threshold or load more on Shopee. |
| No connected listing | Repair | Explain listing navigation, verification, reloading Shopee after installation, and refreshing. Existing saved products remain usable. |
| Saved products | Keep as secondary | A useful shortlist for returning later. Saving clears shortlist filters so the new item is visible. Existing notes are not silently overwritten. |
| Search and sorting | Keep, hide when empty | Search title, collection, or note. Sort by recent save, price, or name. Unknown prices sort last; no-results recovery is explicit. |
| Collections | Simplify | Suggest existing names when editing. Show the filter only when more than one collection exists. No separate management screen. |
| Notes and drafts | Repair | Drafts survive rerenders and same-tab reloads through session storage. Restored drafts open automatically. Failed saves keep input; successful saves clear the corresponding draft. Save before closing the tab. |
| Price history | Keep, simplify | One observation becomes a dated entry with a next step. Chart and exact table appear for two or more observations. Inline change compares with the first retained observation, not an asserted retail or market price. |
| Calculator | Keep as secondary | Require explicit shipping; keep voucher details collapsed until needed. Valid changes update the total after the first calculation. |
| Product switching | Repair | A different product resets shipping, quantity, and voucher terms so assumptions cannot carry over silently. Clear calculator resets everything. |
| Cashback | Remove from interface | Future cashback does not reduce today's payment or help discovery. No saved data is deleted. The internal helper retains its compatible argument. |
| Remove and undo | Keep and repair | Reverse the most recent removal without a confirmation dialog. Undo restores the saved product and its draft. Removing the selected calculator product clears its estimate. |
| JSON backups | Simplify | Remove the nested Restore disclosure. Disable export when empty. Validate and preview restores, skip existing products, and reject malformed JSON before import. |
| Visual gamification | Keep in styling | Blue menu rail, selected section, ornamental frames, circular icons, and engraved lines remain. No XP, quests, rewards, slogans, or shopping gates. |

## Recovery and accessibility

Controls have explicit labels. Calculator errors attach to inputs, reveal hidden voucher fields when necessary, and focus the first invalid field. Status messages report loading, results, saves, and failures. A skip link reaches the workspace. Keyboard focus survives list rerenders where practical; undo receives focus after removal.

Layouts were checked at 1200px and 320px. Visible controls meet a 24px minimum target size in the browser test; the popup fits under Chrome's 600px height limit. Core text/control contrast checks, reduced-motion styles, and forced-colors support remain. This is not a full WCAG assessment or screen-reader certification.

## Verification

- 29 automated tests: parsing, discount ranking/exclusion, tab switching, no-results recovery, draft restoration, failed saves, history retention, calculator reset/arithmetic, backup validation, storage behavior, and contrast tokens.
- Installed Chromium walkthrough: popup → shared threshold → sorted deals → save → edit notes → reload draft → observe price change → estimate → clear → export → remove/undo → reject invalid import → restore → replace closed source → keyboard navigation.
- Desktop, popup, and narrow screenshots inspected. Tests serve a local fixture at the permitted Shopee host; no orders or real account mutations occur.
- JavaScript syntax and release archive checked during packaging.

## Boundaries and deferred ideas

Budol sees loaded Shopee PH listing cards. It does not search the full catalog or verify claimed savings. Product-detail/selected-variant capture, other marketplaces, background crawling, alerts, budget gates, scoring systems, basket optimization, and automatic checkout remain outside this release. Existing saved data and version-1 backups stay compatible.

The older overengineering proposal remains optional exploration. Better listing coverage and reliable discount/price extraction should precede more features. A future user study should time finding and opening a suitable deal, observe no-match recovery, and check understanding of advertised discounts versus personally observed price changes. No success metrics are claimed yet.
