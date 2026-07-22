import {
  VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart, VariantGalleryPart,
} from '@/modules/shop-variations/components/public/VariantParts'
import { bootstrapForCurrentProduct, currentProductSlug } from '@/modules/shop-variations/lib/variation-bootstrap'
import { resolveShopGalleryExtras } from '@/modules/shop/lib/gallery-media'
import {
  shopVariantOptionsPuckComponent,
  shopVariantPersonalisationPuckComponent,
  shopVariantPricePuckComponent,
  shopVariantAddToCartPuckComponent,
  shopVariantGalleryPuckComponent,
  type ShopVariantAddToCartProps,
  type ShopVariantOptionsProps,
} from '@/modules/shop-variations/components/puck/variant-parts'

// Live (RSC) halves of the granular Product Detail blocks. Kept in their own file
// so the server-only payload lookup below - and the prisma reachable through it -
// is never statically reachable from the client Puck editor bundle; the editor
// halves and the Puck field config live in variant-parts.tsx, and the manifest's
// `rscImport` points here. Same split, and same reason, as shop's
// ShopProductDetail.rsc.tsx.
//
// Each block asks for the product being rendered rather than being told: Puck's
// <Render> passes a block only its own saved props, and shop - which knows
// nothing of options, quite deliberately - injects context into its own parts
// alone. The slug is recorded per request by our detail-parts provider as shop
// resolves it, so by the time any of these render it is already there. When it
// isn't, `initial` is null and the island fetches after mount exactly as before.

async function bootstrapProps(): Promise<{ slug: string | null; initial: Awaited<ReturnType<typeof bootstrapForCurrentProduct>> }> {
  return { slug: currentProductSlug(), initial: await bootstrapForCurrentProduct() }
}

// --- Options ---
export async function ShopVariantOptionsRsc(props: ShopVariantOptionsProps) {
  return (
    <VariantOptionsPart
      {...await bootstrapProps()}
      labelPlacement={props.labelPlacement}
      displayMode={props.displayMode}
      accordionInitial={props.accordionInitial}
      accordionOnSelect={props.accordionOnSelect}
      swatchDisplay={props.swatchDisplay}
      swatchPreview={props.swatchPreview}
    />
  )
}
export const shopVariantOptionsPuckRscComponent = { ...shopVariantOptionsPuckComponent, render: ShopVariantOptionsRsc }

// --- Personalisation ---
export async function ShopVariantPersonalisationRsc() { return <VariantPersonalisationPart {...await bootstrapProps()} /> }
export const shopVariantPersonalisationPuckRscComponent = { ...shopVariantPersonalisationPuckComponent, render: ShopVariantPersonalisationRsc }

// --- Price ---
export async function ShopVariantPriceRsc() { return <VariantPricePart {...await bootstrapProps()} /> }
export const shopVariantPricePuckRscComponent = { ...shopVariantPricePuckComponent, render: ShopVariantPriceRsc }

// --- Add to cart ---
export async function ShopVariantAddToCartRsc(props: ShopVariantAddToCartProps) {
  return <VariantAddToCartPart {...await bootstrapProps()} label={props.label} />
}
export const shopVariantAddToCartPuckRscComponent = { ...shopVariantAddToCartPuckComponent, render: ShopVariantAddToCartRsc }

// --- Variant-aware gallery ---
// This block declares Gallery in `coveredSlots`, so where a layout carries it,
// shop's own Gallery part renders nothing at all. That makes this the only strip
// on the page, and therefore the only place a module's contributed gallery media
// (shop's `shop.gallery-media` point) can appear - resolve it here or installing
// such a module would do nothing on exactly the layouts that use this block.
export async function ShopVariantGalleryRsc() {
  const props = await bootstrapProps()
  const productId = props.initial?.payload.productId ?? null
  const extras = productId ? await resolveShopGalleryExtras(productId) : []
  return <VariantGalleryPart {...props} extras={extras} />
}
export const shopVariantGalleryPuckRscComponent = { ...shopVariantGalleryPuckComponent, render: ShopVariantGalleryRsc }
