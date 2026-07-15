import {
  VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart, VariantGalleryPart,
} from '@/modules/shop-variations/components/public/VariantParts'

// Granular storefront parts (mirror shop's ShopDetail* parts) for the Product
// Detail layout. They share selection state through the client selection store
// keyed by the product slug, so they stay in sync when dropped independently.
// Each is a server wrapper -> client island; editor render is preview, RSC live.

// --- Options ---
export function ShopVariantOptions() { return <VariantOptionsPart preview /> }
export const shopVariantOptionsPuckComponent = { label: 'Shop: Variant Options', fields: {}, render: ShopVariantOptions }
export function ShopVariantOptionsRsc() { return <VariantOptionsPart /> }
export const shopVariantOptionsPuckRscComponent = { ...shopVariantOptionsPuckComponent, render: ShopVariantOptionsRsc }

// --- Personalisation ---
export function ShopVariantPersonalisation() { return <VariantPersonalisationPart preview /> }
export const shopVariantPersonalisationPuckComponent = { label: 'Shop: Personalisation', fields: {}, render: ShopVariantPersonalisation }
export function ShopVariantPersonalisationRsc() { return <VariantPersonalisationPart /> }
export const shopVariantPersonalisationPuckRscComponent = { ...shopVariantPersonalisationPuckComponent, render: ShopVariantPersonalisationRsc }

// --- Price ---
export function ShopVariantPrice() { return <VariantPricePart preview /> }
export const shopVariantPricePuckComponent = { label: 'Shop: Variant Price', fields: {}, render: ShopVariantPrice }
export function ShopVariantPriceRsc() { return <VariantPricePart /> }
export const shopVariantPricePuckRscComponent = { ...shopVariantPricePuckComponent, render: ShopVariantPriceRsc }

// --- Add to cart ---
export type ShopVariantAddToCartProps = { label?: string }
export function ShopVariantAddToCart(props: ShopVariantAddToCartProps) { return <VariantAddToCartPart preview label={props.label} /> }
export const shopVariantAddToCartPuckComponent = {
  label: 'Shop: Variant Add to Cart',
  fields: { label: { type: 'text' as const, label: 'Button label' } },
  defaultProps: { label: 'Add to cart' } as ShopVariantAddToCartProps,
  render: ShopVariantAddToCart,
}
export function ShopVariantAddToCartRsc(props: ShopVariantAddToCartProps) { return <VariantAddToCartPart label={props.label} /> }
export const shopVariantAddToCartPuckRscComponent = { ...shopVariantAddToCartPuckComponent, render: ShopVariantAddToCartRsc }

// --- Variant-aware gallery ---
export function ShopVariantGallery() { return <VariantGalleryPart preview /> }
export const shopVariantGalleryPuckComponent = { label: 'Shop: Variant Gallery', fields: {}, render: ShopVariantGallery }
export function ShopVariantGalleryRsc() { return <VariantGalleryPart /> }
export const shopVariantGalleryPuckRscComponent = { ...shopVariantGalleryPuckComponent, render: ShopVariantGalleryRsc }
