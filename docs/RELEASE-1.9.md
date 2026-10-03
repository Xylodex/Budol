# Budol 1.9

Five additions from the GitHub feature review are implemented:

- Explicit listing price ranges and dated manual variant references for estimates. Range history is separate from single-price history.
- Required/excluded keywords, maximum PHP price, range-budget policy, minimum rating and minimum sold filters.
- Saved-product target/new-low watches, pause/resume, browser notifications, local alert inbox and per-watch Discord opt-in.
- Up to four comparison snapshots with available listing evidence and independent one-item checkout estimates.
- UTF-8 CSV of every filtered deal, including matches beyond the visible page, with spreadsheet formula protection.

Existing JSON backups remain compatible. Imported watches are paused with Discord disabled. Notes, webhook credentials and alert delivery state are excluded from deal CSVs. The public ZIP excludes the owner's private webhook seed.

## Verification

52 unit/UI tests and JavaScript syntax checks passed. The installed Chromium journey verifies filters and CSV download, watch setup and observed alert receipt, comparison estimates, previous save/history/calculator/backup workflows, keyboard entry and 320px layout. Discord delivery tests use mocks; no live test messages are sent.

The browser journey uses a local listing fixture on the permitted Shopee origin. Live metadata coverage depends on Shopee's markup. Watches only update from browsing observations; there is no unattended crawler. Comparison resets on board reload, and its snapshots must be re-added to refresh. Manual variant prices are estimate references, not automatic variant tracking.

## Update

Replace files in the same loaded extension folder, reload Budol on the browser's extensions page, then refresh Shopee tabs. Export a JSON backup before uninstalling or changing installation folders. New `notifications` permission supports watch alerts.

The public archive is `dist/budol.zip`. The local unpacked folder is `dist`; it may contain the owner's private setup and should not be distributed.
