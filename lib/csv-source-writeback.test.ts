import { describe, it, expect, beforeEach, vi } from 'vitest'

// A value the sheet invents on a source-backed option has to reach the source
// (the attributes module) as well as this product. It used to reach neither -
// the importer read the source list only to inherit swatches from it - so a
// finish first typed into the sheet never appeared on the attributes screen, had
// no swatch, and carried no ref for a later Refresh to match on.
//
// The importer is all database calls either side of that decision, so the lot is
// stubbed and the assertions sit on what it asked the source to do and what it
// wrote locally.

const createOptionValue = vi.fn(async () => ({ id: `val-${createOptionValue.mock.calls.length}` }))
const createOption = vi.fn(async () => ({ id: 'opt-new' }))
const getOptionsWithValues = vi.fn<() => Promise<unknown[]>>(async () => [])
const createValue = vi.fn<(ref: string, input: { label: string; swatch: string | null }) => Promise<unknown>>()

vi.mock('@prisma/client', () => ({ Prisma: { join: (ids: unknown[]) => ids } }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { $executeRaw: vi.fn() } }))
vi.mock('@/modules/shop/lib/db/products', () => ({
  getProductBySlug: vi.fn(async () => ({ id: 'prod-1', name: 'Impulse Desk', catalogueHidden: false })),
  setProductMedia: vi.fn(),
  updateProduct: vi.fn(),
}))
vi.mock('@/modules/shop/lib/media/product-media', () => ({ reorganiseProductMedia: vi.fn() }))
vi.mock('@/modules/shop-variations/lib/variants-service', () => ({
  getEditorPayload: vi.fn(),
  syncVariantChildNames: vi.fn(),
  upsertVariantForCombination: vi.fn(async () => ({ created: true, changed: false, childProductId: 'child-1' })),
}))
vi.mock('@/modules/shop-variations/lib/db/variants', () => ({
  getProductIdsWithVariations: vi.fn(async () => []),
  getVariants: vi.fn(async () => []),
  getVariantValueMap: vi.fn(async () => ({})),
  getChildProductFields: vi.fn(async () => new Map()),
  setVariantValues: vi.fn(),
}))
vi.mock('@/modules/shop-variations/lib/db/options', () => ({
  getOptionsWithValues: (...args: unknown[]) => getOptionsWithValues(...(args as [])),
  createOption: (...args: unknown[]) => createOption(...(args as [])),
  createOptionValue: (...args: unknown[]) => createOptionValue(...(args as [])),
  updateOptionValue: vi.fn(),
  // The importer dedupes against the option in memory before it ever calls this,
  // so handing the base back untouched is the honest stub.
  ensureUniqueOptionValueSlug: vi.fn(async (_optionId: string, base: string) => base),
  deleteOptionValue: vi.fn(),
}))
vi.mock('@/modules/shop-variations/lib/variant-field-providers', () => ({
  resolveVariantFieldProviders: vi.fn(async () => []),
}))
vi.mock('@/modules/shop-variations/lib/option-sources', () => ({
  resolveOptionSourceProviders: vi.fn(async () => [
    {
      id: 'product-attributes',
      provider: {
        label: 'Attributes',
        listSources: vi.fn(),
        getSource: vi.fn(async () => ({
          ref: 'attr-finish',
          name: 'Finish',
          values: [{ ref: 'src-oak', label: 'Oak', swatch: 'https://cdn/oak.webp' }],
        })),
        createValue,
      },
    },
  ]),
}))

const { importVariationsCsv } = await import('@/modules/shop-variations/lib/csv')

// The Finish option as it stands on the product: sourced from the attribute, and
// carrying the one value that attribute already knows about.
function sourcedFinishOption() {
  return [
    {
      id: 'opt-finish',
      name: 'Finish',
      sourceProvider: 'product-attributes',
      sourceRef: 'attr-finish',
      values: [{ id: 'val-oak', label: 'Oak', slug: 'oak', swatch: 'https://cdn/oak.webp', sourceRef: 'src-oak' }],
    },
  ]
}

const HEADER = 'Parent Slug,Option 1,Value 1,Price'

beforeEach(() => {
  vi.clearAllMocks()
  createOptionValue.mockImplementation(async () => ({ id: `val-${createOptionValue.mock.calls.length}` }))
  createOption.mockImplementation(async () => ({ id: 'opt-new' }))
  getOptionsWithValues.mockImplementation(async () => sourcedFinishOption())
  createValue.mockImplementation(async (_ref, input) => ({ ref: 'src-new', label: input.label, swatch: null }))
})

describe('importVariationsCsv option-source write-back', () => {
  it('adds a label the source has never heard of to the source, and copies its ref down', async () => {
    const result = await importVariationsCsv(
      [HEADER, 'desk,Finish,Oak & White,100'].join('\n'),
    )

    expect(result.errors).toEqual([])
    expect(createValue).toHaveBeenCalledWith('attr-finish', { label: 'Oak & White', swatch: null, slug: null })
    // Local copy keeps the sheet's spelling but takes the source's ref, which is
    // what a later Refresh matches on.
    expect(createOptionValue).toHaveBeenCalledWith('opt-finish', 'Oak & White', 'oak-white', null, expect.any(Number), 'src-new', null)
  })

  it('inherits an existing source value rather than adding it twice', async () => {
    await importVariationsCsv([HEADER, 'desk,Finish,Oak,100'].join('\n'))

    expect(createValue).not.toHaveBeenCalled()
    expect(createOptionValue).not.toHaveBeenCalled() // already on the product
  })

  it('asks the source once when several rows name the same new value', async () => {
    await importVariationsCsv(
      [HEADER, 'desk,Finish,Beech & White,100', 'desk,Finish,Beech & White,120', 'desk,Finish,Maple & White,100'].join('\n'),
    )

    expect(createValue.mock.calls.map((c) => c[1].label)).toEqual(['Beech & White', 'Maple & White'])
  })

  it('takes the swatch the source hands back', async () => {
    createValue.mockImplementation(async (_ref, input) => ({ ref: 'src-new', label: input.label, swatch: '#123456' }))

    await importVariationsCsv([HEADER, 'desk,Finish,Beech & White,100'].join('\n'))

    expect(createOptionValue).toHaveBeenCalledWith('opt-finish', 'Beech & White', 'beech-white', '#123456', expect.any(Number), 'src-new', null)
  })

  it('fails the row rather than writing locally when the source refuses', async () => {
    createValue.mockImplementation(async () => null)

    const result = await importVariationsCsv([HEADER, 'desk,Finish,Beech & White,100'].join('\n'))

    expect(createOptionValue).not.toHaveBeenCalled()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toContain('Beech & White')
  })

  it('leaves a hand-typed option alone', async () => {
    getOptionsWithValues.mockImplementation(async () => [
      { id: 'opt-finish', name: 'Finish', sourceProvider: null, sourceRef: null, values: [] },
    ])

    const result = await importVariationsCsv([HEADER, 'desk,Finish,Beech & White,100'].join('\n'))

    expect(result.errors).toEqual([])
    expect(createValue).not.toHaveBeenCalled()
    expect(createOptionValue).toHaveBeenCalledWith('opt-finish', 'Beech & White', 'beech-white', null, expect.any(Number), null, null)
  })
})
