import { describe, expect, it } from 'vitest'
import { computeAddonPricing } from '@/modules/shop-variations/lib/addon-pricing'
import type { SvrAddon } from '@/modules/shop-variations/lib/types'

// Personalisation pricing. The server calls this to decide what a shopper is
// actually charged for an engraving, so a hole here is money.

function addon(over: Partial<SvrAddon> = {}): SvrAddon {
  return {
    id: 'a1',
    productId: 'p1',
    label: 'Engraving',
    type: 'TEXT',
    required: false,
    position: 0,
    config: {},
    ...over,
  } as SvrAddon
}

describe('free text length', () => {
  it('honours the shop’s own limit and quotes it back', () => {
    const a = addon({ config: { maxLength: 10 } })
    const result = computeAddonPricing([a], { a1: 'a'.repeat(11) })
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('max 10')
  })

  it('accepts a value inside the shop’s limit', () => {
    const a = addon({ config: { maxLength: 10 } })
    expect(computeAddonPricing([a], { a1: 'a'.repeat(10) }).valid).toBe(true)
  })

  // The gap this closed: an add-on with a per-character price and no maxLength
  // took whatever was posted and charged for every character of it.
  it('refuses an absurd value even when the shop set no limit', () => {
    const a = addon({ type: 'TEXTAREA', config: { pricePerChar: 0.5 } })
    const result = computeAddonPricing([a], { a1: 'a'.repeat(5000) })
    expect(result.valid).toBe(false)
    expect(result.priceAdjust).toBe(0)
  })

  it('does not quote a limit the shopper was never told about', () => {
    const a = addon({ type: 'TEXTAREA', config: {} })
    const result = computeAddonPricing([a], { a1: 'a'.repeat(5000) })
    expect(result.reason).not.toContain('max')
  })

  it('still accepts ordinary free text with no limit set', () => {
    const a = addon({ config: { pricePerChar: 0.5 } })
    const result = computeAddonPricing([a], { a1: 'Hello' })
    expect(result.valid).toBe(true)
    expect(result.priceAdjust).toBe(2.5)
  })
})

describe('pricing', () => {
  it('adds a flat price once the field is filled', () => {
    const a = addon({ config: { flatPrice: 4 } })
    expect(computeAddonPricing([a], { a1: 'Bob' }).priceAdjust).toBe(4)
    expect(computeAddonPricing([a], {}).priceAdjust).toBe(0)
  })

  it('prices a select from its chosen option, not from what was posted', () => {
    const a = addon({ type: 'SELECT', config: { choices: [{ value: 'gold', label: 'Gold', price: 12 }] } })
    expect(computeAddonPricing([a], { a1: 'gold' }).priceAdjust).toBe(12)
  })

  it('refuses a select value that is not on the list', () => {
    const a = addon({ type: 'SELECT', config: { choices: [{ value: 'gold', label: 'Gold', price: 12 }] } })
    const result = computeAddonPricing([a], { a1: 'platinum' })
    expect(result.valid).toBe(false)
    expect(result.priceAdjust).toBe(0)
  })

  it('fails a required field that was left empty', () => {
    const a = addon({ required: true })
    const result = computeAddonPricing([a], {})
    expect(result.valid).toBe(false)
    expect(result.reason).toContain('required')
  })

  it('charges nothing at all when nothing is filled in', () => {
    const a = addon({ config: { flatPrice: 4, pricePerChar: 1 } })
    const result = computeAddonPricing([a], {})
    expect(result).toMatchObject({ valid: true, priceAdjust: 0, fields: [] })
  })

  it('rounds to the penny', () => {
    const a = addon({ config: { pricePerChar: 0.1 } })
    expect(computeAddonPricing([a], { a1: 'abc' }).priceAdjust).toBe(0.3)
  })
})
