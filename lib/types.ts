// Domain types for the shop-variations $queryRaw data layer. Column names in
// migrations/001_initial.sql are the source of truth; these describe the
// camelCase shape callers see.

export type SvrControlType = 'DROPDOWN' | 'SWATCH' | 'PILL' | 'IMAGE'

// Cap on the swatch column at the API edge. Roomy because an IMAGE swatch stores
// a media-library url, and the hosted ones carry a folder path and a cache-busting
// suffix - a limit sized for "#ff0000" would reject perfectly ordinary pictures.
export const SWATCH_MAX_LENGTH = 1000

export type SvrOption = {
  id: string
  productId: string
  name: string
  controlType: SvrControlType
  position: number
  // When true the storefront holds this option back until the option before it
  // (in display order) has a value chosen. Dormant on the first option, which
  // has nothing before it - see isOptionVisible in selection-logic.ts.
  requiresPreviousOption: boolean
  // Where the option came from when it was not typed by hand: the extension-point
  // provider that supplied it and that provider's own ref for the source. Both
  // null on a hand-made option. Set together or not at all.
  sourceProvider: string | null
  sourceRef: string | null
  // True when the name above was chosen by the owner rather than inherited from
  // the source. One source can be added to a product more than once (a frame
  // colour and a seat colour off one Colour attribute), and since names must be
  // unique per product all but one of those copies is renamed - so a refresh
  // must stop offering the source's name back once this is set.
  nameOverridden: boolean
}

export type SvrOptionValue = {
  id: string
  optionId: string
  label: string
  // What the control shows beside the label: a hex colour for SWATCH, an image
  // url for IMAGE. Null for DROPDOWN/PILL, and for a SWATCH/IMAGE value nobody
  // has given one to yet - both of those render as the bare label.
  swatch: string | null
  position: number
  // The source value this one was copied from, opaque here. Null on a value added
  // by hand, which a refresh then leaves alone.
  sourceRef: string | null
}

export type SvrOptionWithValues = SvrOption & { values: SvrOptionValue[] }

export type SvrVariant = {
  id: string
  productId: string
  childProductId: string
  enabled: boolean
  position: number
}

export type SvrAddonType = 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'SELECT' | 'CHECKBOX' | 'DATE' | 'FILE'

// Per-type settings for a personalisation add-on. All optional; each type reads
// only the keys it cares about.
export type SvrAddonConfig = {
  placeholder?: string
  helpText?: string
  maxLength?: number
  min?: number
  max?: number
  // Flat surcharge applied when the field is filled in (or the box ticked).
  flatPrice?: number
  // TEXT/TEXTAREA: surcharge per non-space character entered.
  pricePerChar?: number
  // SELECT: the offered choices, each optionally priced.
  choices?: Array<{ label: string; value: string; price?: number }>
  // FILE: per-field overrides of the module-wide upload limits.
  maxFileMb?: number
  allowedTypes?: string
}

export type SvrAddon = {
  id: string
  productId: string
  type: SvrAddonType
  label: string
  required: boolean
  position: number
  config: SvrAddonConfig
}

export type SvrSettings = {
  maxUploadMb: number
  allowedUploadTypes: string
  uploadRetentionDays: number
}

export type SvrUpload = {
  id: string
  token: string
  mediaRef: string
  mediaProvider: string | null
  mediaKey: string | null
  filename: string | null
  size: number
  mimeType: string
  orderItemId: string | null
  ipHash: string | null
  createdAt: Date
}

// The storefront selector payload: everything the product page needs to render
// the option controls, resolve a chosen combination to its child product, and
// show live price/stock/image plus the personalisation fields.
export type VariantSelectorVariant = {
  id: string
  childProductId: string
  optionValueIds: string[]
  enabled: boolean
  // What this combination is actually charged, sale price included when the shop
  // has sale prices switched on. Worked out by shop's effectivePrice, never here,
  // so a variant and an ordinary product can never disagree about the money.
  price: number
  // The struck-through figure when this variant is on offer: its own normal
  // price. Null when it is not, so the storefront has nothing to strike.
  compareAtPrice: number | null
  inStock: boolean
  stockCount: number | null
  // Every image this variant owns, in gallery order (primary first). A variant
  // may carry a whole set of pictures, not one: the first is what the main stage
  // snaps to when the combination is chosen, the rest join the thumbnail strip.
  imageUrls: string[]
  sku: string | null
}

export type VariantSelectorPayload = {
  productId: string
  productName: string
  basePrice: number
  // The parent product's own gallery images, shown until a variant with its own
  // image is chosen (the variant-aware gallery).
  baseImages: Array<{ url: string; alt: string }>
  options: SvrOptionWithValues[]
  variants: VariantSelectorVariant[]
  addons: SvrAddon[]
}

// The same payload, plus the currency symbol, resolved on the server and handed
// to a storefront island as a plain prop. Seeding the selection store with this
// is what lets the option controls arrive in the page's first HTML instead of
// appearing a round-trip later - see lib/variation-bootstrap.ts.
export type VariationBootstrap = {
  payload: VariantSelectorPayload
  currencySymbol: string
}
