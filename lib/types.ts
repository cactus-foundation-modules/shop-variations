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
  // Whether this option also summarises itself on the product card in a grid -
  // the swatches, or a comma-separated list of value labels, under the product's
  // name. Off until the owner asks for it, per option. See card-options-provider.ts.
  cardDisplay: boolean
  // What to call the option on a card, when the product page's name is too long
  // for a tile. Null (and empty) fall back to `name`.
  cardLabel: string | null
  // How many values a card shows before the "+4" marker. Null shows every value
  // and never marks an overflow.
  cardLimit: number | null
  // The other way to cap them: fill exactly this many lines of the tile (1-6),
  // however many values that is at whatever width the card is drawn. The browser
  // does the counting, since only it knows the width. Wins over cardLimit when
  // both are set; null falls back to the cardLimit rule.
  cardFitLines: number | null
}

export type SvrOptionValue = {
  id: string
  optionId: string
  label: string
  // The value's identity within its option. Labels may repeat (two "Black"s told
  // apart by their swatches); slugs may not. The spreadsheet round-trip writes
  // each value cell as "(slug)Label" so a sheet can name either one.
  slug: string
  // What the control shows beside the label: a hex colour for SWATCH, an image
  // url for IMAGE. Null for DROPDOWN/PILL, and for a SWATCH/IMAGE value nobody
  // has given one to yet - both of those render as the bare label.
  swatch: string | null
  // The url of a small rendition of an IMAGE swatch, for thumbnails and card
  // chips - the full-size original stays in `swatch` for the 3D module to paint
  // at true scale. Null (or absent, on rows read before migration 013) means no
  // small copy exists and renderers fall back to `swatch`.
  swatchSmall?: string | null
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
  // Whether this variation's own photo, and separately its own 3D model, are
  // promoted onto the parent product's gallery while the shopper has chosen
  // nothing. Independent flags - a variation worth showing off for its photo is
  // not always the one worth leading with in 3D. Off for all but the handful an
  // owner picks out - see migration 011.
  showImageInGallery: boolean
  showModelInGallery: boolean
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
  // Extra option values this variation also answers to, on top of the ones it
  // carries - a second value of an option that describes the same product, where
  // the choice makes no difference to what turns up (a chair whose back is black
  // AND matches its black seat). Only ever consulted where nothing carries the
  // chosen combination outright, so an alias fills a hole and never shadows a real
  // variation. Empty for all but a handful of variations. See migration 010.
  //
  // Optional because this payload crosses to the browser as JSON and is held in
  // caches that predate the field: one serialised before this shipped carries no
  // such key, and the selection maths has to read that as "no aliases" rather than
  // throwing on the product page. Everything server-side always sets it.
  aliasValueIds?: string[]
  enabled: boolean
  // What this combination is actually charged, sale price included when the shop
  // has sale prices switched on. Worked out by shop's effectivePrice, never here,
  // so a variant and an ordinary product can never disagree about the money.
  price: number
  // The struck-through figure when this variant is on offer: its own normal
  // price. Null when it is not, so the storefront has nothing to strike.
  compareAtPrice: number | null
  inStock: boolean
  // How many of this combination are on the shelf - staff only. Null for every
  // shopper, and null for staff too where the combination tracks no stock of its
  // own, which is why `tracksStock` is carried separately: the two nulls mean
  // different things and only one of them is worth writing on the page.
  stockCount: number | null
  // Whether this combination counts its stock at all. Not gated: it says nothing
  // about quantity, and the shopper-facing `inStock` already implies it.
  // Optional because this payload crosses to the browser as JSON - one
  // serialised before this shipped carries no such key. Always set server-side.
  tracksStock?: boolean
  // Every image this variant owns, in gallery order (primary first). A variant
  // may carry a whole set of pictures, not one: the first is what the main stage
  // snaps to when the combination is chosen, the rest join the thumbnail strip.
  imageUrls: string[]
  // Whether the owner has promoted this variation's first picture, and
  // separately its 3D model, onto the parent's gallery: they join the
  // product's own while nothing has been chosen, and drop out again on the
  // shopper's first pick. Independent of one another. Off for the overwhelming
  // majority.
  //
  // Optional because this payload crosses to the browser as JSON and is held in
  // caches that predate the fields - one serialised before this shipped carries
  // no such keys, which must read as "not promoted" rather than throwing on the
  // product page. Everything server-side always sets both.
  showImageInGallery?: boolean
  showModelInGallery?: boolean
  // This combination's own product code, and the code the supplier's clearance
  // stock is currently ordered under. Both are staff references, so both are
  // null in a shopper's payload rather than merely unrendered - see
  // `showCodes` below. `saleSku` is optional for the same reason as the
  // gallery flags: a payload serialised before it shipped carries no such key.
  sku: string | null
  saleSku?: string | null
  // Null means this variation has none of its own, in which case the parent's
  // supplier (already the fallback shown before any choice is made) stands.
  supplier: string | null
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
  // Wording the shop appends to every price it prints ("inc. VAT"), or '' where
  // it has set none - Shop settings > Tax & shipping. Every money figure in this
  // payload (base price, each variant's price, each add-on's surcharges) has
  // ALREADY been converted server-side to match it, so the picker formats what
  // it is handed and does no tax arithmetic of its own. Optional so an island
  // rendering a payload from an older cached bundle still compiles.
  priceSuffix?: string
  // Whether the person this payload was built for may be shown stock figures -
  // shop's canSeeStockLevels. False for every shopper, in which case each
  // variant's `stockCount` above is withheld (null) rather than merely unused,
  // so the numbers are not sat in a public page's payload waiting to be read out
  // of the network tab. Optional for the same reason as `priceSuffix`.
  showStockCounts?: boolean
  // The PARENT row's own stock, for staff, on a product we claimed without
  // having any options to choose - personalisation add-ons alone. There is no
  // combination to count there, so the parent is the thing being bought and its
  // figure is the one worth writing down. Null for shoppers, and absent on a
  // payload serialised before this shipped.
  baseStock?: { tracked: boolean; count: number | null } | null
  // Whether the person this payload was built for may be shown the buying codes
  // - shop's canSeeProductCodes. False for every shopper, in which case each
  // variant's `sku` and `saleSku` above are withheld (null) rather than merely
  // unused, so a supplier's clearance code is never sat in a public page's
  // payload. Optional for the same reason as `priceSuffix`.
  showCodes?: boolean
}

// The same payload, plus the currency symbol, resolved on the server and handed
// to a storefront island as a plain prop. Seeding the selection store with this
// is what lets the option controls arrive in the page's first HTML instead of
// appearing a round-trip later - see lib/variation-bootstrap.ts.
export type VariationBootstrap = {
  payload: VariantSelectorPayload
  currencySymbol: string
  // Option-value ids the selector should open on, set only when the page was
  // reached through a variant's own deep link (its hidden child product's URL,
  // the same link the cart builds). The store seeds these as the shopper's
  // opening picks so the linked combination is chosen on arrival, its price and
  // gallery already showing. Absent on a normal product page, which opens with
  // nothing chosen (see selection-logic).
  preselectOptionValueIds?: string[]
}
