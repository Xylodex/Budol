# Edge-case audit — 1.9.1

This pass uses source review, adversarial local fixtures and the installed Chromium extension. No live Shopee browsing or real Discord posts were needed. Issue: [#11](https://github.com/Xylodex/Budol/issues/11).

## Fixed and covered

| Scenario | Result |
| --- | --- |
| Discord holds an HTTP response open | Board reads, edits, pauses and removals continue through the storage writer; delivery runs separately. |
| Several products trigger, then a queued watch is paused or changed | Intent is checked again before dispatch; outdated queued alerts are skipped. |
| Alert history is cleared while a send is in flight | Completion updates only an existing receipt; deleted history is never reinserted. |
| Worker restarts after persisting a delivery claim | Claimed sends are not replayed; unconfirmed receipts remain visible. |
| Alert storage contains malformed rows or arbitrary URLs | Invalid rows are ignored; retained links must normalize to Shopee product identities. An alert-read failure does not hide the saved board. |
| Sold label is `1,2 sold`, `1.5 sold`, or exceeds supported bounds | Numeric evidence stays unknown; active minimum-sold filters cannot accept it. Valid grouped counts and k/m counts still work. |
| More than 30 unique keywords are entered | A validation error replaces silent truncation. |
| Show all is used after combined filtering | Product filters and discount-only filtering are both cleared. |
| Watch/variant editing is interrupted by a filter or refresh | Drafts survive in the same tab, including reloads, with explicit discard and unload protection. Saving another form does not erase them. |
| Another backup is selected while an import is finishing | The newer file and preview are preserved; duplicate submits are suppressed and import availability is recomputed. |
| Source refreshes overlap and the older board response arrives last | Older responses cannot overwrite current board state or leave the refresh button saying Working. |
| One Shopee receiver never responds | A five-second per-tab deadline lets other responsive tabs load. |
| User disconnects during a delayed private setup-file read | The stale setup response cannot reconnect the webhook. |

## Existing safeguards reviewed

Price ranges remain separate from single-price history and watch triggers. Unknown prices, ratings and sales fail their active numeric filters. Comparison estimates need explicit shipping and cannot use a range minimum automatically. CSV export includes every filtered match and neutralizes formula-leading text; JSON imports validate identities, counts, amounts and dates. Imported watches remain paused with Discord off. Content observers stop on invalid extension contexts. The public package excludes the private webhook seed.

## Remaining practical limits

- No claim of exhaustive coverage: live Shopee markup, CAPTCHA/login states, regional layouts and variant selectors need the later browser research pass.
- Watch cooldowns suppress observations during the cooldown; there is no delayed resend backlog. A new-low watch needs a later new low to trigger again.
- Extension shutdown may interrupt pending delivery. Budol favors no duplicate external posts over automatic replay. A Discord request already dispatched cannot be recalled.
- Unsaved drafts survive only within the same browser tab's session; comparison snapshots reset on reload.
- A damaged main board backup is rejected rather than silently salvaged or overwritten. Keep JSON backups for recovery.
- Browser notification display depends on operating-system permissions. The local inbox remains the record.

Verification includes targeted concurrency/validation/UI regressions, the full unit/UI suite, JavaScript syntax checks, and an installed Chromium flow covering draft reload recovery plus the existing watch, comparison, export and mobile checks. Generated packages are checked separately for source consistency and private-setup exclusion.
