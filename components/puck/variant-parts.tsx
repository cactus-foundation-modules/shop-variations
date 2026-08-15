import {
  VariantOptionsPart, VariantPersonalisationPart, VariantPricePart, VariantAddToCartPart, VariantGalleryPart,
  type OptionLabelPlacement, type VariantDisplayMode, type AccordionInitial, type AccordionOnSelect, type SwatchDisplay, type SwatchPreview,
  type UnavailableDisplay, type UnavailableOrder } from '@/modules/shop-variations/components/public/VariantParts'

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
  unavailable?: UnavailableDisplay
  unavailableOrder?: UnavailableOrder
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
      unavailable={props.unavailable}
      unavailableOrder={props.unavailableOrder}
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
    unavailable: {
      type: 'radio' as const,
      label: 'Choices this combination cannot have',
      options: [
        { label: 'Show them, with where they are available', value: 'show' },
        { label: 'Hide them', value: 'hide' },
      ],
    },
    // 'keep' is the order the shop typed the values in, which is what this
    // always did and stays the default. 'last' is for the case where a row
    // opens on a dead end - an out-of-stock headrest sitting above the one
    // that is actually in stock.
    unavailableOrder: {
      type: 'radio' as const,
      label: 'Where those choices sit',
      options: [
        { label: 'In their usual place', value: 'keep' },
        { label: 'After the ones that can be picked', value: 'last' },
      ],
    },
  },
  defaultProps: {
    labelPlacement: 'above', displayMode: 'inline', accordionInitial: 'closed', accordionOnSelect: 'openNext', swatchDisplay: 'pill', swatchPreview: 'show', unavailable: 'show', unavailableOrder: 'keep',
  } as ShopVariantOptionsProps,
  // The accordion-only settings appear only in accordion mode, and "after a
  // choice is made" whenever there's a next section left to auto-open - closed
  // or first, not all (nothing left to open there). In accordion mode the
  // section heading is the option name, so "name position" has nothing to govern.
  resolveFields: (data: { props?: ShopVariantOptionsProps }, { fields }: { fields: Record<string, unknown> }) => {
    const p = data?.props ?? {}
    const out: Record<string, unknown> = { ...fields }
    // Nothing to order when the unavailable choices are not drawn at all.
    if (p.unavailable === 'hide') delete out.unavailableOrder
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
export type ShopVariantPersonalisationProps = { heading?: string }
export function ShopVariantPersonalisation(props: ShopVariantPersonalisationProps) {
  return <VariantPersonalisationPart preview heading={props.heading} />
}
export const shopVariantPersonalisationPuckComponent = {
  label: 'Shop: Personalisation',
  fields: {
    // Blank prints nothing at all, which is what this block has always drawn -
    // the fields carry their own labels.
    heading: { type: 'text' as const, label: 'Heading above the fields (blank for none)' },
  },
  defaultProps: { heading: '' } as ShopVariantPersonalisationProps,
  render: ShopVariantPersonalisation,
}

// --- Price ---
const yesNo = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]

export type ShopVariantPriceProps = { showCompare?: string; showSave?: string; showRrp?: string; align?: string }
export function ShopVariantPrice(props: ShopVariantPriceProps) {
  return <VariantPricePart preview showCompare={props.showCompare} showSave={props.showSave} showRrp={props.showRrp} align={props.align} />
}
export const shopVariantPricePuckComponent = {
  label: 'Shop: Variant Price',
  fields: {
    // The same three trimmings shop's own Product: Price offers, and for the
    // same reason - this block replaces it on a product with variations, so an
    // owner who turned the RRP off there was surprised to find it back here.
    showCompare: { type: 'select' as const, label: 'Show "was" price', options: yesNo },
    showSave: { type: 'select' as const, label: 'Show "Save X%"', options: yesNo },
    showRrp: { type: 'select' as const, label: 'Show RRP', options: yesNo },
    align: { type: 'select' as const, label: 'Alignment', options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Centre' },
      { value: 'right', label: 'Right' },
    ] },
  },
  defaultProps: { showCompare: 'yes', showSave: 'yes', showRrp: 'yes', align: 'left' } as ShopVariantPriceProps,
  render: ShopVariantPrice,
}

// --- Add to cart ---
export type ShopVariantAddToCartProps = { label?: string }
export function ShopVariantAddToCart(props: ShopVariantAddToCartProps) { return <VariantAddToCartPart preview label={props.label} /> }
export const shopVariantAddToCartPuckComponent = {
  label: 'Shop: Variant Add to Cart',
  fields: { label: { type: 'text' as const, label: 'Button label' } },
  defaultProps: { label: 'Add to basket' } as ShopVariantAddToCartProps,
  render: ShopVariantAddToCart,
}

// --- Variant-aware gallery ---
export type ShopVariantGalleryProps = { thumbSize?: number }
export function ShopVariantGallery(props: ShopVariantGalleryProps) {
  return <VariantGalleryPart preview thumbSize={props.thumbSize} />
}
export const shopVariantGalleryPuckComponent = {
  label: 'Shop: Variant Gallery',
  fields: {
    // Blank keeps the 56px the strip has always drawn. Applied as a custom
    // property so a contributed 3D thumbnail - styled by the module that
    // supplied it - resizes with the photographs beside it.
    thumbSize: { type: 'number' as const, label: 'Thumbnail size (px, blank for the usual 56)', min: 32, max: 120 },
  },
  defaultProps: { thumbSize: undefined } as ShopVariantGalleryProps,
  render: ShopVariantGallery,
}
