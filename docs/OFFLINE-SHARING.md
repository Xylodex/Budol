# Saved snapshots and images

Budol 1.12.0 can share an item to Discord without a Shopee tab. Saving an item, sharing a live item, or observing changed evidence for an already-saved item retains a public snapshot. Product details include readable price/range, advertised discount, original price, offers and conditions, seller/origin, rating/sales, shipping wording, selected variation when captured, and image URL. Private notes, collections, manual variant references and watch settings are excluded from the share cache and Discord payload.

The service worker downloads a supported image into IndexedDB alongside the snapshot. **It stores the bytes, not only the URL.** Image downloads run independently of board writes. Saving a product can complete while its image is still downloading. Open **Backups & storage → Saved images & share cache → Refresh cache status** to check whether the image is saved locally. Failed downloads leave the text snapshot available.

## Send later

- On a saved product, choose **Send to Discord**. Saved products remain available after closing Shopee or restarting the browser.
- Recently shared items also appear under **Saved images & share cache**, newest first, with **Show more cached items** for older entries.
- Through MCP, call `budol_list_cached` to inspect availability. Call `budol_send_discord` with a product URL and **omit `tab_id`** to use local data. The Budol connector must be connected with changes and Discord enabled, but no Shopee tab is needed. Supplying `tab_id` still captures a currently loaded item.

Cached sends do not fetch Shopee or ask Discord to fetch a Shopee image URL. Images are uploaded as multipart webhook attachments. If no image is retained, the message says it is text-only. A saved board entry can provide its retained text if its separate share cache has been cleared or evicted. Unsaved items require a retained cache entry.

The footer identifies the snapshot capture date; the normal message timestamp is the sharing time. Old offers, prices, variants and stock may have changed. Internet access to Discord remains necessary. Repeated saved/MCP sends share the existing persistent claim guard: repeated request IDs and the same product within 60 seconds are rejected. Uncertain delivery is never retried automatically.

## Storage and cleanup

| Control | Removes | Preserves |
| --- | --- | --- |
| Clear saved images | Downloaded image blobs, including pending downloads | Public cached text snapshots and the saved board |
| Clear share cache | All cached sharing snapshots and image blobs, including pending downloads | Saved products, notes, price/range histories, watches and settings |
| Clear alert history (existing) | Local alert inbox and queued alert delivery | Saved products and their watch settings |
| Remove a saved product (existing) | That saved board entry, observations and watch | Its separate recent-share snapshot until the share cache is cleared/evicted |

The cache shows snapshot count, total image bytes and per-item image availability. It allows at most 200 snapshots and 32 MiB of image bytes. Individual images are limited to 2 MiB. The oldest snapshot is evicted when the item limit is reached; old image blobs can be evicted independently to keep newer snapshots within the byte limit. There is no unlimited-storage permission. Browser storage pressure or uninstalling the extension can remove local data.

Cleanup is local and immediate. It cannot recall an upload already dispatched to Discord. A revision guard prevents downloads started before cleanup from writing their results afterward. New explicit saves/shares and changed saved observations may cache again; cleanup is not a permanent disable switch. Send claims/cooldowns are intentionally preserved so cleanup cannot accidentally make uncertain sends replayable.

JSON backups contain saved product details and image URLs, but exclude the independent share cache and downloaded bytes. Restoring a backup does not fetch images. Items saved before this feature may be text-only until visited/saved again. The feature does not crawl older saved links automatically.

## Download boundaries

Image requests are limited to HTTPS `susercontent.com` hosts, with credentials omitted, no referrer, no redirects, at most three concurrent downloads, an 8-second timeout, and a streamed byte limit even when Content-Length is absent or inaccurate. PNG, JPEG, GIF and WebP signatures are accepted; SVG and unsupported formats remain text-only. No account pages, cookies, cart contents or orders are cached. Image retrieval requires the additional CDN host permission on extension update.

## Verification

Unit/integration tests cover persisted Blob bytes, worker restarts, independent cleanup, clear-during-download races, host/format/size limits, bounded eviction, public-data normalization, multipart attachments, and text-only fallback without deleting settings/board data.

The installed Chromium test saves an item and image, restarts the browser, blocks Shopee access, sends the retained image through a mocked Discord transport, exercises both cleanup buttons and then sends text-only. The restored extension worker's fetch is mocked because browser routing alone does not reliably intercept restored service-worker requests; real Discord DNS is blocked in that test. No real messages are posted. The MCP installed test additionally covers URL-only cached sends with the Shopee tab closed.

Implementation reference: [Discord Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook) documents `files[n]`, `payload_json`, and attachment metadata for multipart uploads. Live image support depends on Shopee's current URLs and responses; inaccessible/oversized images remain visibly unavailable.
