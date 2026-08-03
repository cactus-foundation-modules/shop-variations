import { describe, it, expect, beforeEach, vi } from 'vitest'

// The listener's whole job is a gate: shop calls it after EVERY product write -
// a price, a description, a stock count, hundreds of them in a single sheet Pull
// - and it must cost nothing until the field it actually cares about moves.
// Getting that wrong is not a wrong answer, it is an UPDATE per imported row, so
// the gate is what these tests hold.

const executeRaw = vi.fn(async () => 0)

vi.mock('@/lib/db/prisma', () => ({ prisma: { $executeRaw: (...args: unknown[]) => executeRaw(...(args as [])) } }))

const { syncVariationsOnProductSaved, syncVariantChildTaxClass } = await import('@/modules/shop-variations/lib/tax-class-sync')

describe('syncVariationsOnProductSaved', () => {
  beforeEach(() => { executeRaw.mockClear() })

  it('propagates when the save carried the tax class', async () => {
    await syncVariationsOnProductSaved('prod-1', ['name', 'taxClassId'])
    expect(executeRaw).toHaveBeenCalledTimes(1)
  })

  it('does nothing on a save that left the tax class alone', async () => {
    await syncVariationsOnProductSaved('prod-1', ['price', 'stockCount', 'description'])
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('does nothing for an empty write', async () => {
    await syncVariationsOnProductSaved('prod-1', [])
    expect(executeRaw).not.toHaveBeenCalled()
  })

  it('is parameterised by the parent, never by a value the caller supplies', async () => {
    await syncVariantChildTaxClass('prod-1')
    // The statement carries the parent id as a bound parameter (tagged-template
    // values), not interpolated into the SQL text.
    const values = executeRaw.mock.calls[0]?.slice(1)
    expect(values).toEqual(['prod-1'])
  })
})
