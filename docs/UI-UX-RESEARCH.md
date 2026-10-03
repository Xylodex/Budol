# Budol UI/UX research and applied design

Current implementation: [the 1.7 UX audit](UX-AUDIT.md) supersedes earlier workflow descriptions below. The user selected finding discounted products quickly as the primary job; this document retains the research history.

Research and implementation: 2 October 2026. Scope: the toolbar popup and the local Budol Board. This is a source-based design review and functional verification, not a usability study with recruited shoppers or a claim of full WCAG conformance.

Revision 1.3.1: removed promotional copy, the hero section, uppercase decorative subtitles, tinted section treatments, and repeated branding at the user's request. Use straightforward product labels; do not add slogans in future UI edits. The interaction and accessibility improvements remain.

## Research method

Reviewed ten primary publications from Nielsen Norman Group, Baymard Institute, W3C WAI, and Chrome's extension documentation. Audited the existing HTML, CSS, keyboard behavior, state updates, calculator, and desktop/narrow screenshots against that guidance. Prioritized issues by their effect on completing a shopping decision: understand the price, save a find, retrieve it, estimate payment, and recover from mistakes.

The web search tool was unavailable. Public source pages were retrieved directly from their publishers. Findings below distinguish published guidance from Budol-specific design judgments; research statistics are not treated as measurements of Budol.

## Evidence and decisions

| Source | Relevant finding, paraphrased | Application to Budol |
| --- | --- | --- |
| [NN/g: 10 usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) | Show timely system feedback, make choices recognizable, and support recovery from unwanted actions. | Named loading states, saved status, a separate error announcement, actionable empty states, and a durable Undo area. Keep price source and observation dates near prices. |
| [NN/g: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Put common work first and expose specialized controls when requested; their entry points must remain discoverable. | Collapsible Shopee discovery, voucher/cashback options, notes/history, and backup controls. Saved finds and base cost inputs stay visible. Entered voucher values are acknowledged in the collapsed summary. |
| [Baymard: Quantity selectors](https://baymard.com/blog/auto-update-users-quantity-changes) | Quantity text fields can cause input mistakes, especially on mobile; stepper buttons with a text field and updated totals reduce friction. | Keep direct numeric entry, add minus/plus buttons, enforce 1–999, and update valid totals after the first explicit calculation. Invalidate stale totals immediately. This adapts cart research to a local estimate, not a checkout. |
| [W3C: Target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | WCAG 2.2 AA generally calls for at least 24×24 CSS-pixel targets, with defined exceptions. | Board buttons/inputs use a 44px height as a design target. Compact popup switches and sliders have at least 24px hit height. This does not mean every link must be 44px. |
| [W3C: Text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | Normal text generally needs 4.5:1 contrast; large text has a 3:1 threshold. | Use a small set of dark ink, muted text, and green action colors on explicit surfaces. Increase labels and supporting text from the old 8–10px range. Verify token contrast, not just the appearance of a screenshot. |
| [W3C: Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | Assistive technology should receive useful action results without forcing focus to the message. | Polite live regions for save/read/search/estimate results; a separate alert for failures. Debounce recalculation announcements. Focus moves only where the user needs to act, such as the first invalid field. |
| [W3C: Form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/) | Errors should identify the field, explain how to fix it, and appear in helpful overall and local feedback. | Inline field errors associated using `aria-describedby`, `aria-invalid`, a concise estimate message, and first-error focus. Hidden voucher options open if they contain the invalid field. Do not substitute zero for unknown shipping. |
| [W3C: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) | Vertical content should generally work at 320 CSS pixels without two-dimensional scrolling. | One-column narrow layout, wrapping actions, no fixed-width cards, and a 320px browser check. Avoid nested scrolling for the discovery list; offer six more items per action. History tables retain a bounded scroll area. |
| [W3C: Focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | Keyboard users must be able to see the focused component. | Remove the tall sticky calculator, add visible focus rings and a skip link, preserve note focus through renders, and move focus to newly revealed candidates. No fixed toast covers controls. |
| [Chrome: Add a popup](https://developer.chrome.com/docs/extensions/develop/ui/add-popup) | Toolbar popups close when users focus elsewhere in the browser. | Keep the popup for quick discount settings and an obvious My board action. Longer work stays in the extension tab. No unsaved shopping workflow is moved into the popup. |

## Audit of the original interface

1. **Competing information hierarchy.** Loaded products occupied the top of every visit. The calculator showed every voucher field at once. The page became especially long at narrow widths. Returning users now start with discovery collapsed when they already have saved finds; section links lead to the board, calculator, and backups.
2. **Small, low-emphasis controls.** Popup helper text ranged from 8–10px and switches were 21px high. The revised visual system increases reading sizes, defines consistent surfaces and controls, and retains a compact popup.
3. **Draft loss on render.** Filtering or refreshing recreated note forms from stored data. In-memory drafts and disclosure state now survive those actions. A navigation warning protects dirty drafts from accidental page closure; drafts are not a persistent autosave and should still be saved explicitly.
4. **Undo competed with status messages.** The prior removal action inserted Undo into a notice later actions could replace. Undo now has its own persistent area for the most recent removal.
5. **Calculator completion and recovery.** A form error could be distant or hidden, and recalculation always required another submit. Fields now identify errors, focus goes to the first invalid entry, and valid edits update the first completed estimate. Invalid edits immediately remove the previous total.
6. **Price history could imply uniform sampling.** The original sparkline spaced observations evenly regardless of time. Points now use actual timestamps and a visible date/price range, with an exact table alongside the chart. Listing-price limitations remain visible.
7. **Limited shortlist retrieval.** Add sorting by recency, price, or name; keep unknown prices last; announce filtered counts and provide a clear-filters action with a separate no-results state.

## Design system

- Warm off-white page, white working surfaces, dark green identity, restrained borders. No external fonts or image downloads.
- Board typography: 15px body, 13px support, 17px product names, 24px section headings, 30–44px page heading. Popup typography is compact but larger than before.
- Green filled buttons mark the next useful action. Secondary buttons remain outlined; Remove is quieter and paired with recovery.
- Desktop: saved finds and calculator side by side. At 900px and below, stack them. No sticky overlay competes with keyboard focus.
- Native buttons, labels, details/summary, inputs, and links supply familiar keyboard behavior. Native disclosures avoid implementing a custom tab widget unnecessarily.
- Prices and totals use tabular numerals. Unknown prices stay explicitly unavailable. Data freshness and calculator uncertainty are part of the decision, not hidden in documentation.

## Validation and practical limits

Run existing parsing/storage/arithmetic tests and the real installed-extension flow. Extend browser coverage for inline shipping errors, quantity changes, stale-total removal, note drafts across filters, clear filters, undo, backup restore, 320px reflow, popup dimensions, and keyboard focus. Inspect generated desktop, narrow, and popup screenshots. Verify primary text/control contrast numerically.

Retain the existing Shopee host scope and local-only data model. This redesign adds no network calls or permissions. Tests use local Shopee fixtures; the earlier live markup inspection remains the extraction evidence, and this task does not claim another full live-store compatibility check.

Follow-up research with actual shoppers should test whether users can save a product, return to it, understand listing-price history, calculate a voucher estimate, and recover a removed item without assistance. Record completion, errors, and misunderstood labels. Do not infer conversion improvements or time savings from this design review alone.

## Recorded results

- 24 automated unit/integration checks passed, including new board-state, error-recovery, pagination, and color-contrast checks.
- The installed Chromium extension scenario passed: popup controls, board capture/save, editing, history updates, calculation, quantity changes, invalid-total clearing, draft survival through filtering, export/import, undo, and keyboard skip-link navigation.
- No horizontal overflow at 320 CSS pixels. Visible board buttons, inputs, selects, textareas, and summaries checked in that state measured at least 24px in each dimension.
- The normal popup fit within 356px width and the existing 600px height budget.
- Desktop, narrow, and popup screenshots were visually inspected. Test-fixture product data appears in those screenshots; it is not a user's saved shopping data.
- Text token pairs passed 4.5:1; tested control boundaries and focus indicator passed 3:1. These scoped checks are not a full accessibility audit or screen-reader user test.

Outputs: [desktop preview](../artifacts/browser/extension-installed-extens-88074-gs-and-saves-popup-controls/budol-board-preview.png), [full board](../artifacts/browser/extension-installed-extens-88074-gs-and-saves-popup-controls/budol-board.png), [narrow board](../artifacts/browser/extension-installed-extens-88074-gs-and-saves-popup-controls/budol-board-mobile.png), and [popup](../artifacts/browser/extension-installed-extens-88074-gs-and-saves-popup-controls/popup.png).

## Version 1.4.1: visual direction

The user clarified that gamification meant visual treatment, not reward mechanics. Removed the XP bar, levels, milestone tasks, and progress messages. The board and popup now use a handheld-game palette, dark frames, solid offset shadows, tactile button states, and monospaced price displays. Existing tool labels, navigation, storage, and shopping workflows stay intact. No slogans or game-themed task names.

Decorative elements are CSS only. Keyboard focus remains explicit; reduced-motion and forced-color preferences are supported. Validate the installed extension flow and inspect desktop, 320px board, and popup screenshots.

## Version 1.5: Genshin menu reference

The requested visual reference is Genshin Impact. Inspected the [inventory screen archived by Interface In Game](https://interfaceingame.com/screenshots/genshin-impact-mobile-inventory-food/), focusing on its blue menu surround, cream detail surfaces, gold separators, circular icons, and rounded action buttons. Applied those elements to the board and popup. The desktop section links form a left menu rail; at narrower widths they return to a wrapping row. All links still jump to the same controls.

Decorations and the Budol crest are original local SVGs. Georgia and Trebuchet MS provide a local font approximation. No character artwork, rating stars, currencies, progression, or task mechanics were added. Existing source data, forms, and storage behavior are unchanged. Keyboard focus has separate light- and dark-surface colors, with reduced-motion and forced-color support.

## Version 1.5.1: blue ₱1,000 theme

Applied the requested blue-peso visual theme to the existing Genshin-style menu layout. Replaced warm parchment and gold with pale blue surfaces, cyan trim, and deeper blue text and controls. Original guilloche-style rosettes and engraved-line SVG patterns suggest banknote printing without adding currency values or changing product data. Applied the blue to the crest, toolbar icons, listing highlights, and price charts too.

Validation: existing text/control contrast checks use the updated theme colors; the installed-extension scenario covers the blue listing outline, complete board workflow, popup size, and 320px reflow.

## Version 1.6: expanded Genshin reference study

Inspected three additional Genshin Impact Mobile screens in the Interface In Game archive:

| Reference | Observed detail | Applied to Budol |
| --- | --- | --- |
| [Graphics settings](https://interfaceingame.com/screenshots/genshin-impact-mobile-graphics/) | Rounded setting rows, pale selected surfaces, diamond category indicators | Capsule rows in the popup; round filters; visible active navigation |
| [Archive](https://interfaceingame.com/screenshots/genshin-impact-mobile-archive/) | Large circular category emblems, celestial lines, bright foreground against a dark blue surround | Larger menu medallions; original faint constellation drawing; brighter current-section icon |
| [Weapon selection](https://interfaceingame.com/screenshots/genshin-impact-mobile-weapon-selection/) | Bright selected-item outline, divided detail values, rounded actions | Outline for the product supplying the calculator price; clearer price separators and observation rows; action medallions |

Original corner-frame SVGs and circular arrow icons extend those motifs. The blue PHP 1,000-note palette and engraved patterns remain. The static reference images do not establish animation timing: Budol's 180ms entrance and 150ms selection transitions are implementation choices and respect reduced motion. All ornaments are local, original vectors; there are no fetched game assets.

The existing navigation links retain their anchor behavior. Their highlight follows clicks and keyboard focus, rather than permanently marking Saved products. Using a saved price outlines that source product; typing a manual price removes the outline. This is visual feedback for existing actions, not a progression system. No ratings, rarity stars, quests, currencies, purchases, or extra workflow steps were added.

The Purchase Sword reference failed to load its image and was not used as design evidence.

Version 1.6 validation: 24 automated checks passed; the installed Chromium scenario passed, including source-product outline creation/removal, active calculator and backup navigation, save/edit/calculate/export/import, keyboard entry, popup height, and 320px reflow. Desktop, popup, and narrow screenshots were visually inspected. Static references support appearance; no claim is made that the motion exactly reproduces the game.

