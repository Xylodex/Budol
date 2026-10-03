# Item promotion evidence

Investigated 2026-10-03 for issue #13. Budol 1.10.0 separates an advertised listing discount from additional offers shown with that item. It does not determine account eligibility or a final checkout total.

## Primary references

The official Shopee PH Help Centre was accessible and these articles were read:

- [Cashback vouchers](https://help.shopee.ph/portal/4/article/81245): cashback is credited as Shopee Coins after order completion. Product participation, claiming, checkout selection and redemption limits matter.
- [Using a voucher code](https://help.shopee.ph/portal/4/article/81282): conditions can include minimum spend, product scope, payment/shipping options, account criteria, expiry and available redemptions.
- [Bundle Deals](https://help.shopee.ph/portal/4/article/81279): qualifying quantities and participating products determine the benefit. Ongoing Flash Deal items are excluded from Bundle Deals.
- [Flash Deals](https://help.shopee.ph/portal/4/article/81277): limited sale slots and stock matter; the advertised flash price excludes shipping.

These sources inform the explanations, not an exhaustive rules engine. Shopee may change terms. Always check the current item and checkout.

The homepage briefly exposed public Flash Deals, Free Shipping & Vouchers, Partner Promos, Coins Rewards and 10.10 campaign navigation. Navigation is not evidence that an individual item qualifies. Subsequent live browsing reached CAPTCHA verification and then “Please Try Again Later”; no current product page or checkout was verified. No CAPTCHA bypass, voucher claims, cart changes or orders were attempted.

## HTML evidence and scope

`tests/fixtures/shopee-listing.html` is the existing reduced public listing markup inspected on 2026-10-02. Its accessible promotion-price label and separate percentage badge anchor the price/discount parser.

`tests/fixtures/shopee-offers.html` is **synthetic regression HTML**, patterned on that structure. Its promotion wording and amounts are test cases, not a downloaded live listing or current sale. No account/session HTML is committed.

Budol reads visible, bounded offer text inside an identified listing card. It excludes titles, hidden elements and unrelated page banners. Right-click sharing on a product page additionally looks for explicit promotion rows near the product title, only when the page's canonical Open Graph identity matches the product URL. That reader excludes known recommendation cards, form inputs and delivery-address rows. Unknown layouts remain uncaptured; there is no document-wide offer scan.

## Interpretation

| Evidence | What Budol reports |
| --- | --- |
| Explicit listing percentage | Advertised markdown, with conditional voucher/Coins percentages excluded |
| Voucher/coupon | Potential checkout discount; minimum spend and cap when explicitly stated in PHP |
| Shipping offer | Shipping benefit, separate from the item price |
| Cashback/Coins | Later reward, separate from payment due |
| Bundle | Qualifying item combination or quantity required |
| Add-on | Qualifying main purchase or spend required |
| Flash Deal | Check the current sale slot and stock |
| Payment promotion | Stated payment method required |
| Live/Video offer | Stated purchase route required |
| Campaign claim | Participation and terms need checking |

Evidence retains the wording and source scope. Status is **Eligibility unverified**, or **Check availability** when the captured wording explicitly indicates an unavailable or upcoming offer. Explicit minimum spend, cap, new-user/app-only/selected-item/claim restrictions are parsed as hints. Even when one item's price exceeds a minimum, Budol never declares the voucher eligible. Missing terms remain unknown.

No stacking is calculated. The listing price is not reduced again by badges. Coins are not treated as cash discounts. A visible conditional price caption such as “after voucher” makes a card's price unavailable to budgets, price history and watches. Other conditional wording or unfamiliar markup can still be missed.

## Surfaces and limits

- Deals, Saved and Compare have a collapsed **Offers shown** panel with the captured wording, explanation, source and observation time when available.
- Discord includes up to six bounded offers and indicates additional captured offers. Its message retains listing price and unverified eligibility. No real Discord messages were used for testing.
- CSV adds price conditions and offer evidence. JSON backups retain at most twelve offers per item; imported derived terms/status are re-parsed rather than trusted. Old backups remain compatible.
- Observations are snapshots, not promotion history. Dynamic countdowns are wording, not reliable expiration timestamps. Revisiting cards can replace older evidence; an empty result means not captured, not no offers available.
- There is no API scraping, account inspection, OCR, automatic claiming, stock guarantee, account-specific eligibility check, automatic variant matching or checkout automation.

Regression coverage includes conditional prices, hidden text, site banners, recommendation isolation, minimum/cap interpretation, backup normalization, embed size, CSV and UI. The installed Chromium test uses intercepted local HTML and verifies keyboard expansion and a 320px layout; it does not prove compatibility with every live Shopee layout.
