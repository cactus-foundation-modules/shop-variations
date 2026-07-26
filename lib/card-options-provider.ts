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
// Server-safe and batched, like its two siblings here: one pair of queries for the
// whole grid rather than one per card. The payload crosses the RSC boundary into a
// Puck block's props, so everything it carries is plain JSON. The shape and the
// per-option rule live in card-options.ts, which stays prisma-free because the
// block that renders it is also an editor component.
import type { ShopCardMediaProvider, ShopCardMediaPayload } from '@/modules/shop/lib/card-media'
import { getOptionsWithValuesForProducts } from '@/modules/shop-variations/lib/db/options'
import { summariseOptionForCard, type CardOptionSummary, type CardOptionsFacts } from '@/modules/shop-variations/lib/card-options'

export const shopVariationsCardOptions: ShopCardMediaProvider = {
  async load(productIds) {
    const out = new Map<string, ShopCardMediaPayload>()
    if (productIds.length === 0) return out

    const optionsByProduct = await getOptionsWithValuesForProducts(productIds)
    if (optionsByProduct.size === 0) return out

    for (const [productId, options] of optionsByProduct) {
      const summaries: CardOptionSummary[] = []
      for (const option of options) {
        const summary = summariseOptionForCard(option)
        if (summary) summaries.push(summary)
      }
      // A product where nothing was ticked contributes nothing at all, so its card
      // carries no payload and the block renders nothing on it.
      if (summaries.length > 0) out.set(productId, { facts: { options: summaries } satisfies CardOptionsFacts })
    }
    return out
  },
}
