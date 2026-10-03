# Budol: extension-only feature proposal

Current direction (v1.7): **find discounted products quickly**. See the [UX audit](UX-AUDIT.md). The ideas below are optional exploration, not commitments. Discount-ranked discovery is implemented; additional rules, alerts, budgets, and scoring remain deferred. Cashback was removed from the calculator interface to keep the focus on payment today.

Status: partially delivered in v1.2. Budol Board, collections/notes/search, listing-price observations with charts, a manual-first single-item cost calculator, and JSON backup/restore are implemented alongside the existing filters. Live Shopee search-card markup was inspected on 2026-10-02. The broader features below remain a roadmap, not a claim of complete implementation.

The first release uses a full extension page and bounded `chrome.storage.local` data (200 products, 90 retained observations each), avoiding extra permissions. Prices are explicitly scoped to advertised listings; selected-variant capture, side-panel UI, IndexedDB, multi-item basket optimization, alerts, budgets, cross-store comparison, and ranking remain future work.

## Product direction

Turn Budol into a personal shopping workbench that lives entirely in the browser extension. Keep the popup fast; put comparisons, history, and advanced controls in an extension side panel or full-page extension view. No separate website, account system, server, or hosted AI service is required.

The best first release combines saved products, price observations, and a transparent total-cost calculator. Those features answer three useful questions: what did I want, is this price actually better than before, and what would I pay?

## Proposed features

| Priority | Feature | Shopper experience | Deliberately elaborate extension implementation | Boundary |
| --- | --- | --- | --- | --- |
| 1 | Budol Board | Save products into lists such as desk setup, gifts, or next payday; compare selected items beside the store. | Side panel, tags, notes, variant-aware identity, deduplication, local search, and undoable edits. | Save only products the user selects. Comparison fields can be unknown. |
| 1 | Personal price history | See a small chart and “lowest price you've observed” next to a saved product. | Timestamped observations in IndexedDB, currency and variant normalization, retention rules, and an evidence view for every point. | Observations come from pages visited while Budol is active. This is not complete market history or proof of a fake sale. |
| 1 | True-cost calculator | Compare item price, quantity, shipping, eligible vouchers, and immediate discounts. | A deterministic rule engine for minimum spend, caps, mutually exclusive vouchers, rounding, and multiple basket scenarios. | Missing terms require manual input. Show cashback separately from money paid today; label the result an estimate until checkout confirms it. |
| 2 | Smart filters and profiles | Save rules such as “under PHP 1,500, at least 30% off, ships locally.” | Composable AND/OR rules, per-site profiles, import/export, and an explanation of why each product matched. | Only evaluate fields visibly available on the page. Missing data remains unknown rather than counting as a pass. |
| 2 | Watchlist alerts | Get an alert when a revisited saved product meets a target price or returns to stock. | Observation-triggered rules, notification deduplication, cooldowns, and a local alert log. | Reliable initial scope is alerts on observed changes. Scheduled reminders can ask users to revisit; alarms alone cannot retrieve fresh product data. |
| 2 | Anti-budol mode | Set a shopping budget, add a cooling-off date, and see whether a wishlist exceeds the budget. | Local planned-purchase ledger, category limits, configurable reminders, and what-if basket totals. | Budgets are based on manual entries, not bank balances or assumed completed purchases. Always allow a clear override. |
| 3 | Cross-store comparison | Compare a Shopee item with a Lazada item the user explicitly pairs with it. | Site adapters, normalized product records, variant matching, and a confidence score with the underlying matching evidence. | Add each site's access only when enabled. Confirm uncertain matches; similar titles do not establish identical products. |
| 3 | Deal Lab | Rank saved products according to price, observed history, shipping, and user priorities. | Adjustable scoring weights, sensitivity charts, explainable score breakdowns, and deterministic replay from saved observations. | Scores express user preferences; they do not certify a seller or predict future discounts. No hosted AI dependency. |
| 3 | Local diagnostics and backups | Export lists and history, restore a backup, or see why a page cannot be read. | Versioned JSON backups, schema migrations, import preview, duplicate resolution, adapter diagnostics, and a local debug view. | Validate imported data, bound its size, and render strings as text. No automatic telemetry or uploaded page captures. |

## Architecture that stays inside the extension

```text
Supported shopping page
  -> site adapter in a content script
  -> normalized product observations
  -> validated extension messages
  -> event-driven service worker
       -> IndexedDB: products, observations, lists, alerts
       -> chrome.storage.local: preferences and enabled features
       -> optional notifications and reminder alarms
  -> popup, side panel, or full-page extension view
```

Keep parsing, money arithmetic, voucher eligibility, matching, and scoring as pure modules. Retain the current vanilla JavaScript structure until the UI complexity justifies a framework. A service worker is a proposed addition; the current extension does not need one.

Use explicit product keys such as site + seller + product + variant + currency. Store monetary amounts as integer minor units. Each observation should include its time, source URL, extraction version, and missing fields, so a chart never silently combines incompatible variants or currencies.

Treat service-worker memory as temporary. Persist completed observations and pending work; make event handlers safe to retry. Chrome can stop an idle worker, and its documentation recommends persistent storage rather than relying on global variables. [Service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Use a side panel for the persistent workbench, with an extension-page fallback where needed. Open it through a user action and feature-detect the API before choosing the UI. Verify Chrome and Edge behavior separately. [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

Keep small preferences in local extension storage and larger observation data in IndexedDB. Add retention controls, storage usage reporting, and export before pruning. Local extension storage has a quota; avoid storing whole pages and product images. [Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage).

Add permissions feature by feature: `sidePanel` for the workbench, optional `notifications` for alerts, and optional `alarms` for reminders. Additional marketplace host access should be requested when that marketplace is enabled. Do not add broad access just to support hypothetical future features.

Alarms can be delayed and do not wake a sleeping device. Reconcile reminders when the extension starts, and show last-observed timestamps instead of promising exact-time price monitoring. Automatic background price fetching would need a separate feasibility review of each site's available responses, access requirements, and freshness. [Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms).

## Suggested delivery order

1. **Personal shopping workbench:** Budol Board, local product schema, backups, and the side panel. Done when products survive browser restarts and a backup round-trip preserves lists, notes, and variants.
2. **Better purchase decisions:** observed price history and the manual-first cost calculator. Done when variants never merge incorrectly, missing prices are explicit, and voucher caps and rounding have tested examples.
3. **Personal automation:** smart filters, observed-change alerts, and anti-budol reminders. Done when repeated observations do not spam notifications and worker restarts do not lose saved rules.
4. **Deliberate overengineering:** cross-store adapters, configurable ranking, diagnostics, and replayable observations. Done when adapter failures degrade to clear “unavailable” states without breaking shopping pages.

## Verification strategy

Extend the existing unit and installed-extension tests as features land. Keep saved, sanitized markup fixtures for each supported store and test recycled product cards, navigation, locale-specific prices, unavailable variants, and missing fields. Test migrations against old backups and exercise worker suspension/restart. Measure scans on a large fixture and process changed cards incrementally if full-page scans become expensive.

Avoid adding microservices, Kubernetes, accounts, payments, vector databases, or an LLM merely for architectural complexity. The ambitious part should be a reliable, explainable shopping assistant that remains a self-contained browser extension.
