// @vitest-environment jsdom
// The store is seeded during render, on every island, on every render. Anything
// that seed step does which notifies the islands re-renders them all, which seeds
// again - so it must notify only on a real change, or the first pick sends the
// page into an endless render loop and the whole product page falls over.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VariantSelectorPayload, VariationBootstrap } from '@/modules/shop-variations/lib/types'

const current = vi.hoisted(() => ({ bootstrap: null as unknown }))

vi.mock('@/modules/shop-variations/lib/variation-bootstrap-pack', () => ({
  unpackVariationBootstrap: () => current.bootstrap,
}))
vi.mock('@/modules/shop/components/public/cart', () => ({ addToCart: vi.fn() }))

const { useVariationSelection, setOptionValue, resetOptionValues } = await import('@/modules/shop-variations/lib/use-variation-selection')

function mkPayload(): VariantSelectorPayload {
  const v = (id: string, ids: string[]) => ({
    id, childProductId: `child-${id}`, optionValueIds: ids, enabled: true, inStock: true,
    price: 100, compareAtPrice: null, retailPrice: null, imageUrls: [],
  })
  return {
    productId: 'p', productName: 'Chair', basePrice: 100, baseImages: [], addons: [],
    options: [
      { id: 'A', name: 'Arms', controlType: 'PILL', requiresPreviousOption: false, values: [
        { id: 'A1', label: 'None', slug: 'none', swatch: null },
        { id: 'A2', label: 'Loop', slug: 'loop', swatch: null },
      ] },
      { id: 'U', name: 'Colour', controlType: 'SWATCH', requiresPreviousOption: false, values: [
        { id: 'U1', label: 'Black', slug: 'black', swatch: null },
        { id: 'U2', label: 'Red', slug: 'red', swatch: null },
      ] },
    ],
    variants: [v('a', ['A1', 'U1']), v('b', ['A2', 'U1']), v('c', ['A2', 'U2']), v('d', ['A1', 'U2'])],
  } as unknown as VariantSelectorPayload
}

let slugN = 0
let renders = 0
let last: ReturnType<typeof useVariationSelection> | null = null
let root: Root
let host: HTMLDivElement

function record(sel: ReturnType<typeof useVariationSelection>): void {
  renders += 1
  last = sel
}

function Island({ slug, onRender }: { slug: string; onRender: typeof record }) {
  onRender(useVariationSelection(slug, {} as never))
  return null
}

beforeAll(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  renders = 0
  last = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mount(bootstrap: VariationBootstrap): Promise<string> {
  current.bootstrap = bootstrap
  const slug = `chair-${++slugN}`
  await act(async () => {
    root.render(<><Island slug={slug} onRender={record} /><Island slug={slug} onRender={record} /><Island slug={slug} onRender={record} /></>)
  })
  return slug
}

describe('useVariationSelection seeding', () => {
  it('a pick re-renders each island a bounded number of times, not forever', async () => {
    const slug = await mount({ payload: mkPayload(), currencySymbol: '£' })
    renders = 0
    await act(async () => { setOptionValue(slug, 'A', 'A2') })
    expect(last?.optionValues.A).toBe('A2')
    expect(renders).toBeLessThanOrEqual(6)
    renders = 0
    await act(async () => { setOptionValue(slug, 'U', 'U2') })
    expect(last?.optionValues.U).toBe('U2')
    expect(renders).toBeLessThanOrEqual(6)
  })

  it('opens on a shared link’s picks', async () => {
    await mount({ payload: mkPayload(), currencySymbol: '£', preselectOptionValueIds: ['A2', 'U2'] })
    expect(last?.optionValues).toMatchObject({ A: 'A2', U: 'U2' })
  })

  it('a reset stays reset rather than snapping back to the link’s picks', async () => {
    const slug = await mount({ payload: mkPayload(), currencySymbol: '£', preselectOptionValueIds: ['A2', 'U2'] })
    await act(async () => { resetOptionValues(slug) })
    expect(last?.optionValues).toEqual({})
  })
})
