import { describe, it, expect, vi } from 'vitest'
import {
  VARIATIONS_FIXED_COLUMNS,
  VARIATIONS_EXPORT_GROUPS,
  VARIATIONS_REQUIRED_COLUMNS,
  VARIATIONS_OPTION_GROUP,
  VARIATIONS_EXTRA_GROUP,
} from '@/modules/shop-variations/lib/export-columns'

// The Variations export's column picker cannot list the header up front - the
// Option/Value pairs and the provider columns only exist once the whole grid has
// been built, which on a real catalogue is the export itself. So it offers the
// fixed columns by name and the two moving blocks as one tick each, and the
// exporter matches by position. These pin the two lists to each other: a column
// added to the export without a matching entry in export-columns.ts would
// otherwise be silently unpickable, and a picker key that no longer matches any
// column would silently drop it from every filtered download.

vi.mock('@prisma/client', () => ({ Prisma: { join: (ids: unknown[]) => ids } }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { $executeRaw: vi.fn() } }))
vi.mock('@/modules/shop/lib/db/products', () => ({ getProductBySlug: vi.fn(), setProductMedia: vi.fn(), updateProduct: vi.fn() }))
vi.mock('@/modules/shop/lib/media/product-media', () => ({ reorganiseProductMedia: vi.fn() }))
vi.mock('@/modules/shop-variations/lib/db/options', () => ({
  getOptionsWithValues: vi.fn(async () => []), createOption: vi.fn(), createOptionValue: vi.fn(),
  updateOptionValue: vi.fn(), ensureUniqueOptionValueSlug: vi.fn(), deleteOptionValue: vi.fn(),
}))
vi.mock('@/modules/shop-variations/lib/option-sources', () => ({ resolveOptionSourceProviders: vi.fn(async () => []) }))
vi.mock('@/modules/shop-variations/lib/db/variants', () => ({
  getProductIdsWithVariations: vi.fn(async () => ['prod-1']),
  getVariants: vi.fn(async () => []), getVariantValueMap: vi.fn(async () => ({})),
  getChildProductFields: vi.fn(async () => new Map()), setVariantValues: vi.fn(),
}))
vi.mock('@/modules/shop-variations/lib/variants-service', () => ({
  getEditorPayload: vi.fn(async () => ({
    product: { id: 'prod-1', slug: 'impulse-desk', name: 'Impulse Desk' },
    options: [{ id: 'opt-1', name: 'Finish', values: [{ id: 'val-1', slug: 'oak', label: 'Oak' }] }],
    variants: [{
      childProductId: 'child-1', optionValueIds: ['val-1'],
      sku: 'IMP-OAK', saleSku: 'IMP-OAK-S', price: 199,
      salePrice: 179, retailPrice: 249, tradePrice: 150, costPrice: 99,
      stockCount: 4, minOrderQuantity: 1, barcode: '5012345', supplier: 'Acme',
      weight: 22, imageUrls: ['https://cdn/oak.jpg'],
    }],
  })),
  syncVariantChildNames: vi.fn(), upsertVariantForCombination: vi.fn(),
}))
// One provider column, so the extras block is real rather than empty.
vi.mock('@/modules/shop-variations/lib/variant-field-providers', () => ({
  resolveVariantFieldProviders: vi.fn(async () => [{
    id: 'product-attributes',
    provider: {
      listColumns: vi.fn(async () => [{ key: 'attr-finish', label: 'Finish detail' }]),
      getValues: vi.fn(async () => ({ 'child-1': { 'attr-finish': 'Light oak' } })),
      applyImportedRow: vi.fn(),
    },
  }]),
}))

const { exportVariationsCsv, PRICE_TYPE_COLUMNS } = await import('@/modules/shop-variations/lib/csv')
const { parseCsv } = await import('@/modules/shop/lib/csv')

const OPTION_HEADERS = ['Option 1', 'Value 1']
const EXTRA_HEADERS = ['Finish detail']

describe('variations export column picker', () => {
  it('offers every fixed column the export actually writes', async () => {
    const header = parseCsv(await exportVariationsCsv())[0]!
    const fixed = header.filter((h) => !OPTION_HEADERS.includes(h) && !EXTRA_HEADERS.includes(h))
    expect(fixed).toEqual([...VARIATIONS_FIXED_COLUMNS])
  })

  it('keeps the price-type columns and the picker in step', () => {
    for (const c of PRICE_TYPE_COLUMNS) expect(VARIATIONS_FIXED_COLUMNS).toContain(c)
  })

  it('groups exactly the fixed columns plus the two moving blocks', () => {
    const keys = VARIATIONS_EXPORT_GROUPS.flatMap((g) => g.columns.map((c) => c.key))
    expect([...keys].sort()).toEqual([...VARIATIONS_FIXED_COLUMNS, VARIATIONS_OPTION_GROUP, VARIATIONS_EXTRA_GROUP].sort())
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of VARIATIONS_REQUIRED_COLUMNS) expect(keys).toContain(r)
  })

  it('writes the whole grid when no columns are asked for', async () => {
    const grid = parseCsv(await exportVariationsCsv())
    expect(grid[0]).toEqual(['Parent Slug', 'Parent Name', 'Option 1', 'Value 1', 'Variant SKU', 'Sale SKU', 'Price', ...PRICE_TYPE_COLUMNS, 'Stock', 'Min Qty', 'Barcode', 'Supplier', 'Weight', 'Image', 'Variant ID', 'Finish detail'])
    expect(grid[1]![grid[0]!.indexOf('Variant SKU')]).toBe('IMP-OAK')
  })

  it('writes only the chosen columns, header and cells still aligned', async () => {
    const grid = parseCsv(await exportVariationsCsv(['Variant SKU', 'Price', 'Variant ID']))
    expect(grid[0]).toEqual(['Variant SKU', 'Price', 'Variant ID'])
    expect(grid[1]).toEqual(['IMP-OAK', '199', 'child-1'])
  })

  it('takes the option and extra blocks whole, by their group key', async () => {
    const grid = parseCsv(await exportVariationsCsv(['Variant SKU', VARIATIONS_OPTION_GROUP, VARIATIONS_EXTRA_GROUP]))
    expect(grid[0]).toEqual(['Option 1', 'Value 1', 'Variant SKU', 'Finish detail'])
    expect(grid[1]).toEqual(['Finish', '(oak)Oak', 'IMP-OAK', 'Light oak'])
  })
})
