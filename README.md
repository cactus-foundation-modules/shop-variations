# Shop Variations module

Adds product options to the Cactus shop:

- **Variant matrices** (e.g. Size × Colour) where each combination is a real,
  hidden child product with its own price, SKU, barcode, stock, weight and
  image. The basket, checkout, orders, inventory and refunds all work unchanged
  because a variant is just an ordinary product row that never appears in the
  catalogue.
- **Personalisation add-ons** (engraving text, gift messages, priced dropdowns,
  dates, file/artwork uploads) captured on the product page, priced
  server-side, and carried through to the order, emails and the member account
  area.

Table prefix: `svr_`. Depends on the `shop` module (`>= 0.1.26`). Reuses shop's
`shop.products` permission and joins the existing **Shop** admin nav group.

Requires the shop capabilities added in shop `0.1.26`: the `catalogue_hidden`
product flag, the `shop.product-editor-sections` slot, and the
`shop.cart-line-resolver` line-metadata hook.
