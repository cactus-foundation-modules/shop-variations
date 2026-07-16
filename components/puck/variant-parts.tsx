import {
  VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart, VariantGalleryPart,
} from '@/modules/shop-variations/components/public/VariantParts'

// Granular storefront parts (mirror shop's ShopDetail* parts) for the Product
// Detail layout. They share selection state through the client selection store
// keyed by the product slug, so they stay in sync when dropped independently.
//
// Editor halves only: each renders a labelled skeleton on the Puck canvas, where
// there's no product to speak of. The live RSC halves live in variant-parts.rsc
// (the manifest's `rscImport` points there) so that the payload lookup they do -
// and the prisma it drags in behind it - stays out of the editor's client bundle.

// --- Options ---
export function ShopVariantOptions() { return <VariantOptionsPart preview /> }
export const shopVariantOptionsPuckComponent = { label: 'Shop: Variant Options', fields: {}, render: ShopVariantOptions }

// --- Personalisation ---
export function ShopVariantPersonalisation() { return <VariantPersonalisationPart preview /> }
export const shopVariantPersonalisationPuckComponent = { label: 'Shop: Personalisation', fields: {}, render: ShopVariantPersonalisation }

// --- Price ---
export function ShopVariantPrice() { return <VariantPricePart preview /> }
export const shopVariantPricePuckComponent = { label: 'Shop: Variant Price', fields: {}, render: ShopVariantPrice }

// --- Add to cart ---
export type ShopVariantAddToCartProps = { label?: string }
export function ShopVariantAddToCart(props: ShopVariantAddToCartProps) { return <VariantAddToCartPart preview label={props.label} /> }
export const shopVariantAddToCartPuckComponent = {
  label: 'Shop: Variant Add to Cart',
  fields: { label: { type: 'text' as const, label: 'Button label' } },
  defaultProps: { label: 'Add to cart' } as ShopVariantAddToCartProps,
  render: ShopVariantAddToCart,
}

// --- Variant-aware gallery ---
export function ShopVariantGallery() { return <VariantGalleryPart preview /> }
export const shopVariantGalleryPuckComponent = { label: 'Shop: Variant Gallery', fields: {}, render: ShopVariantGallery }
