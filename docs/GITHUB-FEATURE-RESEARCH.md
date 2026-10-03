# Shopee project research for Budol

Researched 3 October 2026 against Budol 1.8.0. Goal: find discounted products quickly, stay extension-only, and keep the existing blue/Genshin-inspired interface without adding game mechanics.

GitHub repository searches covered extensions, price trackers, discount filters, comparisons and Discord tools. Read 11 available READMEs and inspected selected implementation files in six relevant repositories. This is source inspection, not a claim that these projects currently work on live Shopee Philippines. No external code was installed or executed. Only this research document was added to Budol.

## Closest projects

| Project | What is evidenced | Useful direction for Budol | Caveat |
| --- | --- | --- | --- |
| [icetbr/webext-shopee-advanced-search](https://github.com/icetbr/webext-shopee-advanced-search) | README and content script implement all-keyword matching, excluded words, minimum and maximum sold filters. | Required/excluded terms and optional minimum sold alongside discount filtering. | DOM extraction follows a brittle nested-child structure. Missing sold values become zero. Budol should preserve unknown values. |
| [MikSuki/ShopeePriceExposer](https://github.com/MikSuki/ShopeePriceExposer) | Captures search responses, extracts minimum/maximum price and displays the range on cards. Manifest includes Shopee PH. | Explicit price ranges and, later, selected-variant identity. | Content script renders `$` for all markets; API capture depends on an internal search endpoint. PH permission is not proof of correct PHP handling. A range is not a verified pre-voucher price or proof of a deceptive sale. |
| [DARKNIGHT1028/shopee-price-tracker](https://github.com/DARKNIGHT1028/shopee-price-tracker) | Despite its name, this is a Malaysia listing exporter: price/sold sorting, URL deduplication and spreadsheet download. | Export the filtered Deals list as CSV; add readable sold counts to optional sorting/filtering. | RM-specific parsing; its XLS download is HTML, not a native workbook. Unknown prices sort as zero. |
| [amzar96/shopee-tracker](https://github.com/amzar96/shopee-tracker) | Python code compares current prices with retained history and invokes a Slack alert when lower. | Target-price or new-observed-low notifications. | Uses external data/storage services and scraping. Borrow the alert condition, not its server architecture. |
| [thnguyendinh/shopee-discount-bot](https://github.com/thnguyendinh/shopee-discount-bot) | Telegram search bot with rating filtering, saved tracking, mark-bought/remove actions, and a price-drop condition exceeding 5%. | Optional rating thresholds and an archive/pause action for watched products. | Vietnam-focused; requires MongoDB and a hosted bot. Its price calculation discounts price_min again, whose semantics need validation. Do not copy the calculation into Budol. |
| [dboooloi02-crypto/shopee-analyzer](https://github.com/dboooloi02-crypto/shopee-analyzer) | Extension plus analysis backends; structured-data/DOM extraction, rating/sold/location fields and CSV/Excel exports. | Better field extraction with source and timestamp recorded for each observation. | Seller-research scope is much larger than Budol. README admits mock analytics and market limits. The inspected extract.js has a synchronous authenticated API fallback, so the README's passive-only description does not cover every path. |
| [srph/shopee](https://github.com/srph/shopee) | README describes Discord reminders around monthly N.N sale dates using a daily cron job. | Optional sale-date reminders, if requested later. | Calendar dates do not establish product discounts. A browser extension cannot promise server-like delivery while the browser is closed. Low priority for discovery. |

Also reviewed [duyet/pricetrack](https://github.com/duyet/pricetrack) (Firebase collection/history/alerts), [zhiqisim/Shopee-Price-Tracker](https://github.com/zhiqisim/Shopee-Price-Tracker) (flash-sale watchlists with multiple backend services), [ninhnga/shopee-xtra-filter](https://github.com/ninhnga/shopee-xtra-filter) (affiliate-oriented Safari filters), and [jinwyp/shopeed](https://github.com/jinwyp/shopeed) (primarily JD/Bing cookie extraction despite the name). These provide weaker fits for Budol's current shopper workflow.

## Recommended additions, in order

### 1. Useful deal filters

Add a collapsed More filters area in Deals: required words, excluded words, and maximum PHP price. Example: require “USB C charger”, exclude “cable” and “case”, maximum ₱800, at least 30% advertised discount. Keep the existing threshold prominent. Show an active-filter count and one Clear action.

Start with title and known-price filters because Budol already extracts those fields. Add minimum rating/sold only after reliable numeric parsing is available. Unknown values must be explicit and must not pass a numeric condition silently. Prefer filtering the Budol results first so Shopee's page layout stays predictable. Saved filter presets can follow only if repeated setup becomes a problem.

Effort: small to medium. Strongest immediate fit.

### 2. Price range and variant clarity

Today Budol intentionally marks ambiguous ranges unavailable. Represent them explicitly as priceMin/priceMax rather than collapsing them into one price. Display “₱199–₱699 · varies by variant” in Deals and Discord. A maximum-price filter should distinguish “at least one variant within budget” from “all variants within budget.”

Keep a selected variant's price separate from the listing range. Only pass a single confirmed amount into the calculator; never treat the lowest variant as the price of every option. Variant-specific history needs variant identity, schema migration and preservation of existing listing history.

Effort: medium to large. High value, with live PH fixtures needed before release.

### 3. Observed price-drop alerts

Let a saved product have a target price or “new lowest observed price” condition. On a later page visit, compare the same product/variant with its prior observations and show a local notification. Label last-observed time and make clear that this is not a full-market monitor.

Discord delivery would require a separate explicit opt-in per watch or globally; existing one-click sharing must not become automatic posting. Deduplicate alerts, add a cooldown, and provide Pause/archive. No background crawling is needed for a first release.

Effort: medium. Builds on existing price history and Discord delivery.

### 4. Compare a small shortlist

An original Budol adaptation of the research workflows: select two to four products and compare price/range, observed low, rating/count, seller/origin, manually entered shipping and total estimate. Clearly distinguish missing data and different variants. Users choose comparable products; title similarity should not assert equivalence.

Effort: medium. Helpful after discovery, but secondary to filters and reliable prices.

### 5. Export current deals

Export only the current filtered list as a real UTF-8 CSV, with PHP amounts, ranges, discount, rating/sold where known, source URL and capture time. Keep JSON for backups. Escape fields and neutralize spreadsheet formulas. No need for a workbook library or additional service in the first version.

Effort: small. Useful for external comparison or sharing a shortlist; keep behind a secondary action.

## What to defer

Do not add seller profit dashboards, opaque deal scores, cookie export, automated purchasing, cross-market currency conversion, or server-backed scraping just because other repositories have them. Budol already has listing history, notes/collections, a calculator, deduplication and Discord embeds; reproducing those adds little. Calendar reminders and automatic Discord feeds should wait for explicit demand.

The more valuable internal improvement is a shared product-evidence model used by Deals, saved history and Discord: value, scope (listing/range/variant), source, and observation time. Preserve missing data instead of substituting zero. Prefer visible DOM and product-linked structured data; evaluate narrowly scoped passive response capture only when needed, with strict identity/schema validation and no unrelated session data collection.

## Source checks and reuse

Repository metadata checked during this review showed these last-push dates: Advanced Search 2025-03-01; PriceExposer 2026-06-07; Malaysia exporter 2026-09-16; amzar96 tracker 2023-10-13; Telegram bot 2025-09-18; analyzer 2026-09-23. Push dates are activity indicators, not evidence of current compatibility.

GitHub reports MIT for the analyzer. Advanced Search's README declares MIT, but the inspected tree did not include a LICENSE file. Several other inspected repositories did not expose a recognized license in GitHub metadata. Treat these as design references; verify applicable licensing before reusing implementation code.

Key implementation references:

- [Advanced Search filtering](https://github.com/icetbr/webext-shopee-advanced-search/blob/main/src/content.js)
- [PriceExposer response extraction](https://github.com/MikSuki/ShopeePriceExposer/blob/main/src/inject.ts), [display and currency handling](https://github.com/MikSuki/ShopeePriceExposer/blob/main/src/content.ts), [market matches](https://github.com/MikSuki/ShopeePriceExposer/blob/main/src/manifest.json)
- [Exporter extraction](https://github.com/DARKNIGHT1028/shopee-price-tracker/blob/main/content.js), [sorting and output](https://github.com/DARKNIGHT1028/shopee-price-tracker/blob/main/popup.js)
- [History-to-alert condition](https://github.com/amzar96/shopee-tracker/blob/master/app.py)
- [Telegram search, tracking and alert logic](https://github.com/thnguyendinh/shopee-discount-bot/blob/main/shopee_discount_bot.py)
- [Analyzer structured-data, API and DOM extraction](https://github.com/dboooloi02-crypto/shopee-analyzer/blob/main/extension/content/extract.js)

Recommended next release: required/excluded keywords plus maximum price, followed by trustworthy price ranges. Those changes most directly reduce the time from opening Shopee to finding a relevant deal.
