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
import { getVariantsForProducts, getVariantValueMapForProducts } from '@/modules/shop-variations/lib/db/variants'
import { buildCardOptionsFacts, type CardPreviewVariantInput } from '@/modules/shop-variations/lib/card-options'
import type { SvrVariant } from '@/modules/shop-variations/lib/types'

export const shopVariationsCardOptions: ShopCardMediaProvider = {
  async load(productIds) {
    const out = new Map<string, ShopCardMediaPayload>()
    if (productIds.length === 0) return out

    const optionsByProduct = await getOptionsWithValuesForProducts(productIds)
    if (optionsByProduct.size === 0) return out

    // Which variation each option value belongs to, so the card can show the photo
    // for the combination a shopper is hovering (the block's "Preview the photo"
    // setting). Two set-wide queries, and only for the products that actually put
    // an option on their card - a shop that has never ticked one runs neither.
    const previewIds = [...optionsByProduct]
      .filter(([, options]) => options.some((o) => o.cardDisplay))
      .map(([productId]) => productId)
    const variantsByProduct: Map<string, SvrVariant[]> = previewIds.length > 0 ? await getVariantsForProducts(previewIds) : new Map()
    const valuesByProduct: Map<string, Record<string, string[]>> = previewIds.length > 0 ? await getVariantValueMapForProducts(previewIds) : new Map()

    for (const [productId, options] of optionsByProduct) {
      // A switched-off variation is not on sale, so it is not something to preview -
      // the same rule the sibling media provider applies to its photos, and it keeps
      // the two lists agreeing about which variations a card knows about.
      const valuesByVariant = valuesByProduct.get(productId) ?? {}
      const variants: CardPreviewVariantInput[] = (variantsByProduct.get(productId) ?? [])
        .filter((v) => v.enabled)
        .map((v) => ({ childProductId: v.childProductId, valueIds: valuesByVariant[v.id] ?? [] }))

      const facts = buildCardOptionsFacts(options, variants)
      // A product where nothing was ticked contributes nothing at all, so its card
      // carries no payload and the block renders nothing on it.
      if (facts) out.set(productId, { facts })
    }
    return out
  },
}
