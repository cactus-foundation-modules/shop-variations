// The `shop.product-social-image` provider. Shop asks what picture the product
// page will open on for THIS request, so the social preview (og:image) of a
// shared link shows the very configuration the link carries rather than the
// product's stock photograph.
//
// The answer replays exactly the gallery's own opening-image derivation
// (use-variation-selection.ts): the resolved variation's first picture when the
// request arrives with a full combination - a variant's own deep-link slug, or
// option parameters written by a shopper sharing the address bar - else the
// parent's first photograph or a promoted variation's, whichever the owner put
// at the front of the gallery. Declines (null) on a product we don't claim, and shop falls back to
// its own first photograph.
//
// Server-safe: runs inside generateMetadata. Registered through
// extensionPoints alongside our product-page resolver; precedent for the
// pattern: lib/product-page-resolver.ts.
import { currentProductPageSearchParams } from '@/modules/shop/lib/product-page-params'
import type { ShopProductSocialImageProvider } from '@/modules/shop/lib/product-social-image'
import type { ShpProduct } from '@/modules/shop/lib/types'
import { getVariationBootstrap } from '@/modules/shop-variations/lib/variation-bootstrap'
import { selectionValueIdsFromParams } from '@/modules/shop-variations/lib/url-selection'
import { resolveVariant, valueToOptionMap, withAutoSelected, withStrandedFilled, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'
import { mergeGalleryItems } from '@/modules/shop-variations/lib/gallery-order'

export const shopVariationsSocialImage: ShopProductSocialImageProvider = {
  async resolve(product: ShpProduct): Promise<string | null> {
    const bootstrap = await getVariationBootstrap(product.slug)
    if (!bootstrap) return null
    const { payload } = bootstrap

    // The request's picks: a deep link's combination if the bootstrap carries
    // one (the resolver recorded it before we were asked), else whatever the
    // URL's own option parameters name. Either way the same ids the storefront
    // will seed the controls from.
    let valueIds = bootstrap.preselectOptionValueIds ?? []
    if (valueIds.length === 0) {
      const searchParams = currentProductPageSearchParams()
      if (searchParams) valueIds = selectionValueIdsFromParams(payload, searchParams)
    }

    const valueToOption = valueToOptionMap(payload)
    const raw: OptionSelection = {}
    for (const valueId of valueIds) {
      const optionId = valueToOption.get(valueId)
      if (optionId) raw[optionId] = valueId
    }

    // The same derivation the hook runs, so the picture promised to the
    // scraper is the picture the page opens on: stranded picks filled, then
    // single-choice options auto-settled - but only once something is picked.
    const effective = withStrandedFilled(payload, raw)
    const optionValues = Object.keys(raw).length > 0 ? withAutoSelected(payload, effective) : effective
    const variant = resolveVariant(payload, optionValues)

    const variantImages = variant?.imageUrls ?? []
    const promoted = !variant ? payload.variants.filter((v) => v.enabled) : []
    // The same merge the gallery does: the product's own photographs with the
    // promoted variations folded in where the owner put them on the Images tab.
    // The scraper is promised the picture the page will open on, so the answer
    // has to be the front of that one list, not a guess between two piles.
    const gallery = mergeGalleryItems(
      payload.baseImages.map((i) => i.url),
      promoted.flatMap((v) => {
        if (!v.showImageInGallery) return []
        const url = v.imageUrls[0]
        return url ? [{ galleryPosition: v.galleryPosition ?? null, item: url }] : []
      }),
    )
    return variantImages[0] ?? gallery[0] ?? null
  },
}
