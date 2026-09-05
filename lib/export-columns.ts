// The Variations CSV's column list, in one client-safe place. It cannot live in
// lib/csv.ts alongside the exporter: that file pulls in Prisma, and the column
// picker is a client component.
//
// The export's header is partly dynamic - `Option N`/`Value N` grow with the
// widest product's option count, and other modules hang their own columns on the
// end through the variant-field-provider point. Neither can be listed up front
// without building the whole grid, which on a large catalogue is the export
// itself. So the picker offers the fixed columns by name and the two moving sets
// as one tick each, and the exporter matches each column against its "kind"
// rather than its label.

export const VARIATIONS_OPTION_GROUP = '__options__'
export const VARIATIONS_EXTRA_GROUP = '__extras__'

// Every fixed column, in the order the export writes them. `Sale Price`, `RRP`,
// `Trade Price` and `Cost Price` come from PRICE_TYPE_COLUMNS in lib/csv.ts and
// are repeated here rather than imported, because importing that file into a
// client component would drag Prisma with it. The round-trip test asserts the
// two lists agree.
export const VARIATIONS_FIXED_COLUMNS = [
  'Parent Slug', 'Parent Name', 'Variant SKU', 'Sale SKU', 'Price',
  'Sale Price', 'RRP', 'Trade Price', 'Cost Price',
  'Stock', 'Min Qty', 'Barcode', 'Supplier', 'Weight', 'Image', 'Variant ID',
] as const

// `Variant ID` is what the importer (and the Google-Sheet Pull) matches a row
// back to its variant on, ahead of the option/value set. A file without it can
// still be read, but a renamed option value then reads as a different variant
// rather than a rename - so the picker keeps it ticked and greyed out.
export const VARIATIONS_REQUIRED_COLUMNS: readonly string[] = ['Variant ID']

export type VariationsExportGroup = { label: string; columns: Array<{ key: string; label: string; hint?: string }> }

export const VARIATIONS_EXPORT_GROUPS: readonly VariationsExportGroup[] = [
  {
    label: 'The variant',
    columns: [
      { key: 'Parent Slug', label: 'Parent web address' },
      { key: 'Parent Name', label: 'Parent name' },
      { key: 'Variant SKU', label: 'Variant code' },
      { key: 'Sale SKU', label: 'Sale code' },
      { key: 'Variant ID', label: 'Variant ID', hint: 'Needed to put the file back in' },
    ],
  },
  {
    label: 'Options and values',
    columns: [
      { key: VARIATIONS_OPTION_GROUP, label: 'Every option and value column', hint: 'Colour, size and the rest - as many pairs as the widest product needs' },
    ],
  },
  {
    label: 'Prices',
    columns: [
      { key: 'Price', label: 'Price' },
      { key: 'Sale Price', label: 'Sale price' },
      { key: 'RRP', label: 'RRP' },
      { key: 'Trade Price', label: 'Trade price' },
      { key: 'Cost Price', label: 'Cost price' },
    ],
  },
  {
    label: 'Stock and stockists',
    columns: [
      { key: 'Stock', label: 'Stock count' },
      { key: 'Min Qty', label: 'Minimum order quantity' },
      { key: 'Barcode', label: 'Barcode' },
      { key: 'Supplier', label: 'Supplier' },
    ],
  },
  {
    label: 'Size and pictures',
    columns: [
      { key: 'Weight', label: 'Weight' },
      { key: 'Image', label: 'Pictures' },
    ],
  },
  {
    label: 'Added by other parts of the shop',
    columns: [
      { key: VARIATIONS_EXTRA_GROUP, label: 'Extra columns from other features', hint: 'Product attributes and anything else hung on the variations grid' },
    ],
  },
]
