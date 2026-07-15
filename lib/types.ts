// Domain types for the shop-variations $queryRaw data layer. Column names in
// migrations/001_initial.sql are the source of truth; these describe the
// camelCase shape callers see.

export type SvrControlType = 'DROPDOWN' | 'SWATCH' | 'PILL'

export type SvrOption = {
  id: string
  productId: string
  name: string
  controlType: SvrControlType
  position: number
}

export type SvrOptionValue = {
  id: string
  optionId: string
  label: string
  // hex colour or media id for SWATCH controls; null otherwise
  swatch: string | null
  position: number
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
  maxVariants: number
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
  price: number
  inStock: boolean
  stockCount: number | null
  imageUrl: string | null
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
