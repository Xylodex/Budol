# Parcel tracking

Open Budol's extension options page, choose a carrier, and save a tracking number with an optional label. Saving does not contact a carrier. **Refresh** requests permission for that carrier's host, then fetches its public tracker. The number is never sent to an aggregator, Discord, or the MCP bridge.

Up to 50 parcels and the latest 100 scans per parcel stay in `chrome.storage.local`. Reopening options works offline. Each successful response shows its fetch time; failed refreshes retain the previous scans and show an error. There is no scheduled polling. Refreshes are limited to one per carrier at a time and one every 30 seconds; a carrier's `Retry-After` can extend that delay. Clear cached scans keeps saved numbers. Clear saved parcels removes both. Neither resets rate limits. Parcel data is separate from product backups.

## Carrier support

| Carrier | In-app behavior | Official tracker |
| --- | --- | --- |
| SPX Express PH | Public website endpoint; shows scans and carrier status when available | [SPX](https://spx.ph/track) |
| J&T Express PH | Checks CAPTCHA requirement; queries only when the carrier explicitly disables verification | [J&T](https://www.jtexpress.ph/trajectoryQuery?flag=1) |
| LBC Express | Reads a fresh public page nonce, then calls the site's tracking endpoint | [LBC](https://www.lbcexpress.com/track/) |
| Ninja Van PH | Saves the parcel and opens the official tracker; no in-app API lookup | [Ninja Van](https://www.ninjavan.co/en-ph/tracking) |
| Flash Express PH | Saves the parcel; copy the number and open the official tracker | [Flash Express](https://www.flashexpress.ph/tracking/) |

These are public **website endpoints**, not a promise of supported developer APIs. They can change, reject requests from extensions, or require verification. Budol does not bypass CAPTCHA, use logged-in cookies, or claim success on blocked/malformed responses. J&T's gate required verification during research, so its current normal path is the official tracker. A successful lookup for a real parcel was not available during implementation; successful response handling is tested with fixtures based on the carrier frontends.

## Sources and contracts (reviewed 2026-11-03)

### SPX

The [official tracking app loader](https://deo.shopeemobile.com/shopee/shopee-spx-live-ph/static/js/app.508cda450.js) loads a tracking action module in chunk `8601`. That module first calls:

`GET https://spx.ph/shipment/order/open/order/get_order_info?spx_tn=NUMBER&language_code=en-ph`

Success requires numeric `retcode: 0`. Scans are `data.sls_tracking_info.records[]` (`description`, epoch-second `actual_time`); status is `data.order_info.tracking_code_subgroup_name`. Budol checks `order_info.sls_tn` when returned. An invalid synthetic identifier returned a JSON error during research. The app also contains a signed legacy fleet-order route; Budol does not use it.

### J&T

The [official app](https://www.jtexpress.ph/js/app.eac6dcdf.js) and [common component bundle](https://www.jtexpress.ph/js/chunk-common.a641443d.js) define the tracking form and its CAPTCHA mixin:

1. `GET https://ylofficialjw.jtexpress.ph/website/base/info/captcha/isShowSlider`
2. Only for `code === 1` and `data === false`, `POST /website/track/query` with `{billCodes:[NUMBER], verify:"test", vck:"test"}`. These sentinel values are the site's own explicitly disabled-verification path, never a substitute for a required CAPTCHA.
3. Headers use `langType: EN`, `timezone: GMT+0800`, and an empty `authToken`.

The scan response uses `succ`, `data[].billcode`, and `details[]` (`scanstatus`, `acceptTime`, `city`). Dates without an explicit timezone remain carrier text. When verification is required or its gate is unrecognized, Budol stops without sending the tracking number. The gate returned `data: true` during research; no protected query was attempted.

### LBC

The [official tracker script](https://www.lbcexpress.com/wp-content/themes/silicon-child/assets/js/track-package.js?ver=1.0.12) uses `track_package_nonce` published in the [tracking page](https://www.lbcexpress.com/track/). Budol reads the nonce as text, without executing downloaded code, and posts form fields `action=track_package`, `security=NONCE`, `trackingNumber=NUMBER` to the fixed URL `https://www.lbcexpress.com/wp-admin/admin-ajax.php`.

Success requires `success: true`, then `data.Body.LBCTrackAndTraceResponse.LBCTrackAndTraceResult.TrackingStatus.StatusCode === "0001"` and an exact `TrackingDetails.TrackingDetails.TrackingNo` match. Only scan descriptions and date/time strings are retained. Sender/recipient names, addresses, contact details, and raw payloads are discarded. Tracking numbers remain strings, preserving leading zeroes. The frontend reverses the carrier's oldest-first history; Budol follows that order.

### Other carriers

[Ninja Van's documented API](https://api-docs.ninjavan.co/) requires shipper credentials. Its [recipient help](https://www.ninjavan.co/en-ph/support/shipper-support/how-to-ship/how-do-i-track-my-parcel) directs users to its public tracker. Flash Express is offered as an official-site shortcut only; no anonymous API contract is claimed.

## Boundaries and verification

- Only `options.html` can read or mutate parcels through tracking runtime messages.
- Host access is optional and carrier-specific. Requests omit credentials and referrers, reject redirects, time out after 15 seconds, and cap response bodies at 2 MB.
- Carrier text is rendered with `textContent`. No remote script runs inside the extension.
- Storage writes are serialized. Remove/clear aborts active lookups; a generation check prevents late results from restoring deleted scans.
- Unit tests cover input validation, duplicate/size limits, permission denial, identity mismatch, CAPTCHA gating, bounded parsing, HTTP/network failures, persisted throttling, and clear/delete races.
- The Chromium test exercises save/refresh, persistence without network activity, stale-cache feedback, literal hostile markup, permissions refusal, official-site fallback, cleanup, and a 360 px viewport using deterministic fixtures. It does not send real parcel numbers.

Run `npm test`, `npm run check`, and `npm run test:browser` before release. To verify a carrier with your own parcel, save its actual tracking number in options, refresh, and compare the most recent scan with the official tracker. Never commit parcel numbers or cached responses.
