# Discord sharing — Budol 1.9

Right-click a Shopee PH product and choose **Send item to Discord**. The action sends immediately to the locally configured webhook. It does not save the product to the board or upload any notes, collections, history, cart, or account information.

## Product evidence

- The title links to a canonical Shopee product URL without tracking parameters.
- Listing cards supply readable price, advertised discount, product image and optional crossed-out price, rating, sold count, seller, origin and shipping text.
- Missing or ambiguous prices remain unknown. Optional fields are omitted instead of guessed. Product-detail pages only use Open Graph metadata when its URL identifies the current product; otherwise they provide a link with no asserted price.
- Images must use HTTPS on Shopee or its image CDN domains. Discord retrieves the image from its URL; Budol does not download or attach it.
- An embed footer records the sharing time. Copy distinguishes advertised discounts from verified savings and asks viewers to confirm variant and checkout terms.

## Delivery and recovery

The content script captures the item under the right-click. The worker requests that exact snapshot and checks its canonical identity against the clicked product link. A click elsewhere clears the selection. A two-minute expiry prevents old selections being reused.

The worker posts a bounded embed with `allowed_mentions: { parse: [] }` and `wait=true`, and reports success only after receiving a Discord message ID. In-flight clicks are suppressed; successful same-tab/product sends have a ten-second duplicate guard. A 429 response stores its retry time. Network uncertainty is reported without automatic retry, because Discord may already have accepted the message. Closed/unrefreshed tabs get a reload instruction. Status appears on Shopee and on the toolbar badge.

The settings page accepts only tokenized HTTPS Discord webhook URLs, optionally with a numeric thread ID. A forum channel needs that thread ID. Webhook credentials are never included in message payloads, board exports, or user-facing error text. Saving settings makes no delivery request. Content pages cannot read or modify settings through worker messages.

## Local setup and packaging

Saved-product watches can also send listing snapshots when a target price or new observed low is reached during browsing. This requires explicit Discord opt-in on each watch. A durable claim and 24-hour product cooldown are stored before sending; the local Price alerts inbox reports results and uncertain delivery is never retried automatically. Ranges and manual variant references do not trigger alerts. Imported watches are paused with Discord off. Disconnecting the webhook prevents later sends until it is configured again.

The owner's ignored `extension/discord-local.json` seeds the webhook into `chrome.storage.local` on extension installation/reload. It is not a public source file. The package script explicitly excludes it from `dist/budol.zip`, then copies it separately to the local unpacked `dist` folder. Shared ZIPs require setup through Options. Disconnect sets a marker so subsequent reloads cannot silently reconnect from the seed.

Reload Budol, accept changed extension permissions if the browser requests them, then refresh Shopee to install the context-menu capture script. The extension needs `contextMenus`, `notifications` and Discord host access in addition to storage permission. Notifications open the local Price alerts inbox.

## Verification and references

Tests exercise endpoint validation, exact right-click selection, embed fields and private-data exclusion, invalid/revoked webhooks, duplicate clicks, 429 cooldown, ambiguous delivery, trusted settings access, one-time local setup and disconnect. The installed Chromium flow verifies setting validation, persistence and disconnect using a fake endpoint. No live test post is sent to the owner's channel.

Implementation follows [Discord Execute Webhook](https://docs.discord.com/developers/resources/webhook#execute-webhook) for confirmed delivery and mention suppression, and the [Chrome contextMenus API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus) for extension menu registration and frame-aware click handling. Optional metadata depends on the Shopee layout; this is not a claim of complete seller, variant, or inventory coverage.
