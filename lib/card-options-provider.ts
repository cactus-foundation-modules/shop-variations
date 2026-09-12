// Summarises a product's variation options for its CARD in a grid - the tile on
// a category page or the shop home - so a shopper can see at a glance that a
// chair comes in eight colours without opening it.
//
// Only options the owner has ticked "Display in categories" for take part
// (svr_options.card_display), so this stays off until asked for and a product
// with six options does not turn a tile into a spec sheet.
//
// Registered at shop's `shop.card-media` point, which despite the name is the
// single seam for everything a companion module pins to a card: extra images, an
// overlay control, and - added for this - an opaque `facts` payload a module's own
// card block renders itself (see modules/shop/lib/card-media.ts). Going through
// the existing point rather than a new one means every card surface that already
// shows variation photos shows this too, with no extra wiring to keep in step.
//
// The payload also carries a small lookup from option values to variation photo
// tags, so the card block (with its "Preview the photo" setting on) can show the
// picture for whatever combination the shopper is hovering without a round trip.
// See buildCardOptionsFacts in card-options.ts for what is and is not in it.
//
// Server-safe and batched, like its two siblings here: one pair of queries for the
// whole grid rather than one per card. The payload crosses the RSC boundary into a
// Puck block's props, so everything it carries is plain JSON. The shape and the
// per-option rule live in card-options.ts, which stays prisma-free because the
// block that renders it is also an editor component.
import type { ShopCardMediaProvider, ShopCardMediaPayload } from '@/modules/shop/lib/card-media'
import { getOptionsWithValuesForProducts } from '@/modules/shop-variations/lib/db/options'
import { buildCardOptionsFacts } from '@/modules/shop-variations/lib/card-options'

export const shopVariationsCardOptions: ShopCardMediaProvider = {
  async load(productIds) {
    const out = new Map<string, ShopCardMediaPayload>()
    if (productIds.length === 0) return out

    const optionsByProduct = await getOptionsWithValuesForProducts(productIds)
    if (optionsByProduct.size === 0) return out

    // The variation matrix is NOT built here any more.
    //
    // It answers "which photo is this combination?" and is only wanted once a
    // shopper points at a swatch, but building it here put it in every card of
    // every grid: 255 KB of flight payload on the live homepage, plus two
    // set-wide queries on every grid render, for something most visitors never
    // use. The card island asks for its own product's matrix on the first sign
    // of interest instead - app/api/public/card-preview, which serves it from a
    // shared cache and calls the same builder, so the seat numbering agrees by
    // construction.
    //
    // So the summaries below are built with no variants, which is exactly what
    // buildCardOptionsFacts does with an empty list: the option rows unchanged,
    // and no preview attached.

    for (const [productId, options] of optionsByProduct) {
      const facts = buildCardOptionsFacts(options, [])
      // A product where nothing was ticked contributes nothing at all, so its card
      // carries no payload and the block renders nothing on it.
      if (facts) out.set(productId, { facts })
    }
    return out
  },
}
