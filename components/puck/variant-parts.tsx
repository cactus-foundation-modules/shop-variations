import {
  VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart, VariantGalleryPart,
  type OptionLabelPlacement, type VariantDisplayMode, type AccordionInitial, type AccordionOnSelect, type SwatchDisplay, type SwatchPreview,
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
export type ShopVariantOptionsProps = {
  labelPlacement?: OptionLabelPlacement
  displayMode?: VariantDisplayMode
  accordionInitial?: AccordionInitial
  accordionOnSelect?: AccordionOnSelect
  swatchDisplay?: SwatchDisplay
  swatchPreview?: SwatchPreview
}
export function ShopVariantOptions(props: ShopVariantOptionsProps) {
  return (
    <VariantOptionsPart
      preview
      labelPlacement={props.labelPlacement}
      displayMode={props.displayMode}
      accordionInitial={props.accordionInitial}
      accordionOnSelect={props.accordionOnSelect}
      swatchDisplay={props.swatchDisplay}
      swatchPreview={props.swatchPreview}
    />
  )
}
export const shopVariantOptionsPuckComponent = {
  label: 'Shop: Variant Options',
  fields: {
    displayMode: {
      type: 'radio' as const,
      label: 'How the choices are shown',
      options: [
        { label: 'All choices on show', value: 'inline' },
        { label: 'Accordion (one section per option)', value: 'accordion' },
      ],
    },
    labelPlacement: {
      type: 'radio' as const,
      label: 'Option name position',
      options: [
        { label: 'Above the choices', value: 'above' },
        { label: 'Beside the choices', value: 'beside' },
      ],
    },
    accordionInitial: {
      type: 'radio' as const,
      label: 'When the page loads',
      options: [
        { label: 'Keep every section closed', value: 'closed' },
        { label: 'Open the first section', value: 'first' },
        { label: 'Open every section', value: 'all' },
      ],
    },
    accordionOnSelect: {
      type: 'radio' as const,
      label: 'After a choice is made',
      options: [
        { label: 'Leave the next section closed', value: 'none' },
        { label: 'Open the next section', value: 'openNext' },
        { label: 'Open the next section and close this one', value: 'openNextCloseCurrent' },
      ],
    },
    swatchDisplay: {
      type: 'radio' as const,
      label: 'Colour & image choices',
      options: [
        { label: 'Pill with name and swatch', value: 'pill' },
        { label: 'Swatch only (name on hover)', value: 'swatchOnly' },
      ],
    },
    swatchPreview: {
      type: 'radio' as const,
      label: 'Colour & image previews',
      options: [
        { label: 'Show a bigger look on hover', value: 'show' },
        { label: 'No preview', value: 'hide' },
      ],
    },
  },
  defaultProps: {
    labelPlacement: 'above', displayMode: 'inline', accordionInitial: 'closed', accordionOnSelect: 'openNext', swatchDisplay: 'pill', swatchPreview: 'show',
  } as ShopVariantOptionsProps,
  // The accordion-only settings appear only in accordion mode, and "after a
  // choice is made" whenever there's a next section left to auto-open - closed
  // or first, not all (nothing left to open there). In accordion mode the
  // section heading is the option name, so "name position" has nothing to govern.
  resolveFields: (data: { props?: ShopVariantOptionsProps }, { fields }: { fields: Record<string, unknown> }) => {
    const p = data?.props ?? {}
    const out: Record<string, unknown> = { ...fields }
    if (p.displayMode !== 'accordion') {
      delete out.accordionInitial
      delete out.accordionOnSelect
    } else {
      delete out.labelPlacement
      if (p.accordionInitial === 'all') delete out.accordionOnSelect
    }
    return out
  },
  render: ShopVariantOptions,
}

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
