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
// first. Declines (null) on a product we don't claim, and shop falls back to
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
    const featuredImages = promoted.filter((v) => v.showImageInGallery).map((v) => v.imageUrls[0]).filter((url): url is string => !!url)
    const baseImage = payload.baseImages[0]?.url
    return (
      variantImages[0]
      ?? (payload.baseImagesLast ? featuredImages[0] ?? baseImage : baseImage ?? featuredImages[0])
      ?? null
    )
  },
}
