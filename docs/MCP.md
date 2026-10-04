# Codex MCP integration

Budol 1.13.0 exposes eleven tools through a local stdio MCP server. Codex starts the server; a small authenticated HTTP broker connects it to an opt-in Budol extension tab. No public server, API key, native-messaging registry entry or Shopee API is required.

## Setup

Use Node.js 24 LTS and the full repository, not only the extension ZIP. From the repository:

```powershell
npm ci
npm run mcp:setup -- --register
```

Setup creates `%USERPROFILE%/.budol-mcp/config.json` (or `~/.budol-mcp/config.json`), fills the ignored `extension/mcp-local.json` file, and also updates the private pairing file in `dist` if that installation already exists. `--register` runs `codex mcp add budol` using absolute paths to this checkout and the current Node executable. It updates the named `budol` entry; other MCP servers are unchanged. Rerun setup after moving the repository or changing the Node path.

1. Reload Budol on the browser's extensions page and refresh open Shopee tabs.
2. Open **Discord settings → Codex MCP**, then **Connect**. Allow the requested local bridge and Shopee host access. The pairing fields are filled from your private setup file.
3. Leave the connector tab open. It starts read-only. To permit mutations, disconnect, enable **Allow saving and removing products**, and reconnect. Discord additionally needs **Also allow explicit Discord sends** and an existing webhook in Discord settings.
4. Restart MCP servers in Codex settings (or restart Codex) after registration. Ask Codex to check Budol status and list Shopee tabs.

If Codex is not on PATH, omit `--register` and configure a stdio server named `budol` in Codex settings: command = the absolute Node executable, arguments = the absolute path to `mcp/server.mjs`. For example, the CLI equivalent is:

```powershell
codex mcp add budol -- node D:/Github/Budol/mcp/server.mjs
```

Use a Node executable accessible to the desktop app. The equivalent TOML is:

```toml
[mcp_servers.budol]
command = "node"
args = ["D:/Github/Budol/mcp/server.mjs"]
```

For a separately extracted public ZIP, copy the private pairing file from your own setup into that unpacked extension folder or paste your `extensionToken` and port into the connector. Do not paste `clientToken`. The keys never appear in MCP outputs or setup logs. Do not share either local config file. The repository and public ZIP exclude both `mcp-local.json` and `discord-local.json`.

## Tools

| Tool | Purpose |
| --- | --- |
| `budol_status` | Starts/checks the local bridge; reports connector state and access switches |
| `budol_list_tabs` | Shopee PH tab IDs and titles only |
| `budol_get_products` | Loaded listing cards, prices, discount claims and offer evidence; keyword, discount and price filters; pagination |
| `budol_list_saved` | Saved public evidence, optionally retained single-price/range histories; title search and pagination |
| `budol_list_cached` | Retained public sharing snapshots, capture dates and image availability; no Shopee tab needed |
| `budol_get_external_history` | Direct PriceTrack PH variant history or AiPrice Shopee/Lazada listing history; requires the provider's optional host permission |
| `budol_get_alerts` | Recent price alerts without clearing them or sending messages |
| `budol_calculate` | A manual estimate; explicit shipping and eligible voucher terms; Coins remain separate |
| `budol_save_product` | Save an exact product URL from the specified loaded tab |
| `budol_remove_saved` | Remove a saved product, its retained history and watch |
| `budol_send_discord` | Share a saved/cached snapshot with local image bytes when `tab_id` is omitted; supply `tab_id` to capture a loaded product |

Inputs and returned price amounts use integer PHP centavos, except `max_price_php`, which is a decimal PHP string. `keywords` is a comma-separated list of required title terms. A price range matches a maximum price when its starting price fits. Unknown prices/discounts fail the corresponding filters. Listing reads inspect at most 200 loaded cards, return 20 by default and at most 50 per page. `next_offset` identifies the next page. Saved queries follow the same pagination. Alerts return the latest 20 by default, at most 50.

Example requests to Codex:

- “Use Budol to list the Shopee tabs and find loaded keyboards under ₱1,000 with at least 30% advertised discount. Explain the voucher conditions.”
- “Show my saved items and their observed price history.”
- “Save this product from tab 123 to Budol.”
- “Send that product to my configured Discord channel.” (Requires both connector switches.)

For saved/cached sends, omit `tab_id`; the browser connector stays open but Shopee can be closed. Images are uploaded from the local cache or omitted if unavailable. See [saved sharing and cleanup](OFFLINE-SHARING.md). After upgrading from 1.11, restart the Codex MCP server to refresh its tools. If an older broker reports an unknown command, close connector tabs and let the old broker idle for 95 seconds before checking status again.

Tools do not navigate, scrape more pages, solve verification, claim vouchers, configure watches, inspect account/cart/order data, or place orders. An empty product list can mean no loaded cards, a CAPTCHA or an unsupported layout. Open/scroll the page normally and refresh Shopee after updating Budol. Existing price-watch behavior continues separately when you browse.

## Connection behavior

The stdio servers share one broker bound exclusively to `127.0.0.1:38479`. MCP clients and the extension use different random 256-bit keys. The broker validates exact Host, role-specific authentication, extension Origin and a per-connection session ID. Ordinary web origins cannot use it. There is no externally connectable extension API or arbitrary browser/script execution tool.

Only one browser connector can hold the lease. Disconnect it before connecting another browser/profile. Closing the tab expires the lease within 35 seconds. Explicit disconnect drops pending requests immediately. Writes recheck connection state before dispatch. A write already dispatched to the extension worker or Discord cannot be recalled. The broker exits after 90 seconds without authenticated activity; a subsequent `budol_status` or browser tool restarts it. Calculations do not need a browser connection. Multiple Codex clients can share the bridge, but all see the one connected browser profile and its access switches.

Each request is delivered once and expires after 25 seconds; at most 16 can be pending. Tools are never replayed after cancellation, timeout, disconnect or failed acknowledgment. Discord requests are claimed in browser local storage before posting, retain the latest 100 claim records, and reject repeated request IDs or the same product within 60 seconds across restarts. An uncertain result may still have posted: check Discord before asking for another send. The context menu and price watches retain their separate existing delivery controls.

The connector transmits bounded public product evidence and, when requested, local price observations. Private notes, collection names, watch configuration and webhook secrets are excluded. It stores no permanent browser-pairing state and resets action switches when reopened. Recent request UI logs show only tool names and outcomes. The broker keeps pending data in memory and does not log product bodies or keys. The browser retains bounded MCP send-claim IDs, product URLs and attempt times separately from backups.

## Troubleshooting and removal

- **Disconnected:** ask Codex for `budol_status`, open the connector and click Connect. Nothing connects automatically on browser startup.
- **Another connector active:** disconnect the old page or wait 35 seconds after closing it.
- **Port occupied/authentication failed:** close connector pages and let an old broker exit, or change `port` in the local configuration to an unused port from 1024–65535, rerun setup and restart the MCP server. Never bind the broker to a public interface.
- **Pairing key exposed:** close connectors and stop using MCP, wait for the broker to exit, remove your private config and rerun setup to generate new keys. Replace private pairing files in every unpacked installation.
- **Browser sleeps or suspends the tab:** a request can time out and requires a manual reconnect. Keep the connector active for long sessions; there is no silent browser background access.
- **Remove integration:** run `codex mcp remove budol`, close the connector, and delete your private pairing files/config if no longer needed. Optional host permissions can be revoked through the browser's extension settings. Budol's normal features still work.

## Verification and references

Tests negotiate real SDK stdio sessions, share a broker across clients, reject bad authentication/origins/hosts, expire requests without replay, exclude private fields, enforce write opt-in and retain Discord claims across worker restarts. The installed Chromium flow drives actual MCP requests through the connector into intercepted Shopee HTML, exercises saves/removal and disconnect, and checks a 320px layout. It pregrants optional hosts only in its disposable profile; production uses the browser permission prompt. Discord delivery tests use mocks and never send real messages. Live browser compatibility beyond Chromium and every Shopee layout is not claimed.

- [Official Codex MCP configuration](https://developers.openai.com/codex/mcp)
- [Official MCP TypeScript SDK server guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/docs/server.md)
- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)

`budol_get_external_history` reads PriceTrack PH or AiPrice directly using `provider`, `url`, and optional `variant_id`. Enable the provider once from the board. No shopping tab or write/Discord opt-in is needed. Results retain source, listing/variant scope, timestamps, cache/stale status and PHP centavos. See [External history](EXTERNAL-HISTORY.md).
