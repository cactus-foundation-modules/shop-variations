import { describe, it, expect } from 'vitest'
import { tickBoxValues, withTickBoxDefaults, withAutoSelected, resolveVariant } from '@/modules/shop-variations/lib/selection-logic'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

// Width then a power module offered as a tick box - the shape this exists for.
// `moduleWidths` are the widths that come with the module as well as without.
function mkPayload(opts: { moduleWidths?: string[]; withoutWidths?: string[]; powerLabels?: [string, string] } = {}): VariantSelectorPayload {
  const v = (id: string, ids: string[]) => ({ id, childProductId: id, optionValueIds: ids, enabled: true, inStock: true, price: ids.includes('P1') ? 145 : 100, compareAtPrice: null, imageUrls: [] })
  const widths = ['W140', 'W160']
  const moduleWidths = opts.moduleWidths ?? widths
  const withoutWidths = opts.withoutWidths ?? widths
  const [offLabel, onLabel] = opts.powerLabels ?? ['No', 'Yes']
  return {
    productId: 'p', basePrice: 5, baseImages: [], addons: [],
    options: [
      { id: 'W', name: 'Width', controlType: 'PILL', requiresPreviousOption: false, values: widths.map((id) => ({ id, label: `${id.slice(1)}cm`, swatch: null })) },
      { id: 'P', name: 'Power Module', controlType: 'CHECKBOX', requiresPreviousOption: false, values: [{ id: 'P0', label: offLabel, swatch: null }, { id: 'P1', label: onLabel, swatch: null }] },
    ],
    variants: [
      ...withoutWidths.map((w) => v(`${w}-P0`, [w, 'P0'])),
      ...moduleWidths.map((w) => v(`${w}-P1`, [w, 'P1'])),
    ],
  } as unknown as VariantSelectorPayload
}

const opt = (controlType: string, labels: string[]) => ({ controlType, values: labels.map((label, i) => ({ id: `v${i}`, label })) })

describe('tickBoxValues', () => {
  it('reads No as unticked and Yes as ticked', () => {
    expect(tickBoxValues(opt('CHECKBOX', ['No', 'Yes']))).toEqual({ off: { id: 'v0', label: 'No' }, on: { id: 'v1', label: 'Yes' } })
  })

  it('finds the without value wherever the owner put it', () => {
    const pair = tickBoxValues(opt('CHECKBOX', ['Pop-up Power Module', 'No Module']))
    expect(pair?.off.label).toBe('No Module')
    expect(pair?.on.label).toBe('Pop-up Power Module')
  })

  it('falls back to the first value as unticked when neither label says without', () => {
    expect(tickBoxValues(opt('CHECKBOX', ['Standard', 'Upgraded']))?.off.label).toBe('Standard')
  })

  it('does not mistake a word that merely starts with no', () => {
    expect(tickBoxValues(opt('CHECKBOX', ['Nordic Oak', 'None']))?.off.label).toBe('None')
  })

  it('is null for anything but a two-value tick box', () => {
    expect(tickBoxValues(opt('PILL', ['No', 'Yes']))).toBeNull()
    expect(tickBoxValues(opt('CHECKBOX', ['Yes']))).toBeNull()
    expect(tickBoxValues(opt('CHECKBOX', ['No', 'Black', 'White']))).toBeNull()
  })
})

describe('withTickBoxDefaults', () => {
  it('fills an untouched box with its without value', () => {
    expect(withTickBoxDefaults(mkPayload(), {})).toEqual({ P: 'P0' })
  })

  it('leaves a box the shopper ticked alone', () => {
    expect(withTickBoxDefaults(mkPayload(), { W: 'W140', P: 'P1' })).toEqual({ W: 'W140', P: 'P1' })
  })

  it('resolves a full combination once the other options are chosen, unticked', () => {
    const payload = mkPayload()
    const selection = withTickBoxDefaults(payload, { W: 'W160' })
    expect(resolveVariant(payload, selection)?.id).toBe('W160-P0')
  })

  it('leaves the box empty where the width only comes with the module, so it settles ticked', () => {
    const payload = mkPayload({ withoutWidths: ['W140'] })
    const defaulted = withTickBoxDefaults(payload, { W: 'W160' })
    expect(defaulted).toEqual({ W: 'W160' })
    expect(withAutoSelected(payload, defaulted)).toEqual({ W: 'W160', P: 'P1' })
  })

  it('ignores options that are not tick boxes', () => {
    const payload = mkPayload()
    payload.options[1]!.controlType = 'PILL'
    expect(withTickBoxDefaults(payload, {})).toEqual({})
  })
})

describe('withTickBoxDefaults on an optional RAL option', () => {
  function ralPayload(): VariantSelectorPayload {
    const v = (id: string, ids: string[]) => ({ id, childProductId: id, optionValueIds: ids, enabled: true, inStock: true, price: 100, compareAtPrice: null, imageUrls: [] })
    return {
      productId: 'p', basePrice: 5, baseImages: [], addons: [],
      options: [{ id: 'R', name: 'Frame colour', controlType: 'RAL', requiresPreviousOption: false, values: [
        { id: 'R0', label: 'No RAL colour', swatch: null }, { id: 'R1', label: 'RAL 9016 Traffic white', swatch: null },
      ] }],
      variants: [v('a', ['R0']), v('b', ['R1'])],
    } as unknown as VariantSelectorPayload
  }

  it('picks No RAL colour while the box is unticked', () => {
    expect(withTickBoxDefaults(ralPayload(), {})).toEqual({ R: 'R0' })
  })

  it('leaves the colour open once the shopper ticks the box', () => {
    expect(withTickBoxDefaults(ralPayload(), {}, new Set(['R']))).toEqual({})
  })
})
