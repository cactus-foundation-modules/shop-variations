import { describe, it, expect } from 'vitest'
import { RAL_CLASSIC, RAL_FAMILIES, findRal, ralCodeInLabel, ralLabel, searchRal } from '@/modules/shop-variations/lib/ral-classic'
import { checkCustomRal, customRalMeta, isCustomRalLabel, ralOptionParts } from '@/modules/shop-variations/lib/ral-option'

const option = (labels: string[], controlType = 'RAL') => ({ controlType, values: labels.map((label, i) => ({ id: `v${i}`, label })) })

describe('RAL Classic chart', () => {
  it('holds every colour once, each with a four-digit code and a six-digit colour', () => {
    const codes = RAL_CLASSIC.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes.length).toBeGreaterThan(200)
    for (const c of RAL_CLASSIC) {
      expect(c.code).toMatch(/^\d{4}$/)
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/)
      expect(c.name.length).toBeGreaterThan(0)
    }
  })

  it('files every colour under one of the nine families', () => {
    const digits = new Set(RAL_FAMILIES.map((f) => f.digit))
    for (const c of RAL_CLASSIC) expect(digits.has(c.code[0] ?? '')).toBe(true)
  })

  it('finds a code however it was typed', () => {
    expect(findRal('5015')?.name).toBe('Sky blue')
    expect(findRal('RAL 5015')?.name).toBe('Sky blue')
    expect(findRal(' ral5015 ')?.name).toBe('Sky blue')
    expect(findRal('5016')).toBeNull()
    expect(findRal('50')).toBeNull()
    expect(findRal('')).toBeNull()
  })

  it('reads the code out of a value label', () => {
    expect(ralCodeInLabel('RAL 7016 Anthracite grey')).toBe('7016')
    expect(ralCodeInLabel('Custom RAL')).toBeNull()
    expect(ralCodeInLabel('RAL 0000 Nothing')).toBeNull()
  })

  it('searches by code prefix and by name', () => {
    expect(searchRal('7016')[0]?.code).toBe('7016')
    expect(searchRal('70').every((c) => c.code.startsWith('70'))).toBe(true)
    expect(searchRal('anthra').map((c) => c.code)).toContain('7016')
    expect(searchRal('')).toEqual([])
  })

  it('writes a colour the chart way', () => {
    expect(ralLabel(findRal('9016')!)).toBe('RAL 9016 Traffic white')
  })
})

describe('ralOptionParts', () => {
  it('splits suggestions from the custom choice, wherever the custom choice sits', () => {
    const parts = ralOptionParts(option(['RAL 9016 Traffic white', 'Custom RAL', 'RAL 9005 Jet black']))
    expect(parts?.custom?.id).toBe('v1')
    expect(parts?.suggestions.map((s) => s.colour?.code)).toEqual(['9016', '9005'])
  })

  it('keeps a suggestion that names no RAL code, without a chart colour', () => {
    const parts = ralOptionParts(option(['Bare steel', 'RAL 9005 Jet black']))
    expect(parts?.suggestions[0]?.colour).toBeNull()
    expect(parts?.custom).toBeNull()
  })

  it('recognises a renamed custom choice', () => {
    expect(isCustomRalLabel('Custom colour')).toBe(true)
    expect(isCustomRalLabel('Customer favourite')).toBe(false)
  })

  it('is null for any other control type', () => {
    expect(ralOptionParts(option(['RAL 9016 Traffic white'], 'PILL'))).toBeNull()
  })
})

describe('checkCustomRal', () => {
  const parts = ralOptionParts(option(['RAL 9016 Traffic white', 'RAL 9005 Jet black', 'Custom RAL']))!

  it('accepts any chart colour that is not a suggestion', () => {
    const check = checkCustomRal(parts, '5015')
    expect(check.ok && check.colour.name).toBe('Sky blue')
  })

  it('refuses a suggested colour, so it is never charged at the custom price', () => {
    expect(checkCustomRal(parts, '9016')).toMatchObject({ ok: false, reason: 'suggested' })
  })

  it('refuses a code the chart does not have, and an empty box', () => {
    expect(checkCustomRal(parts, '1234')).toMatchObject({ ok: false, reason: 'unknown' })
    expect(checkCustomRal(parts, '')).toMatchObject({ ok: false, reason: 'empty' })
    expect(checkCustomRal(parts, undefined)).toMatchObject({ ok: false, reason: 'empty' })
  })
})

describe('customRalMeta', () => {
  it('keeps plain string codes and drops anything else the browser sent', () => {
    expect(customRalMeta({ ral: { a: '5015', b: 5015, c: { x: 1 }, d: 'x'.repeat(40) } })).toEqual({ a: '5015' })
    expect(customRalMeta({})).toEqual({})
    expect(customRalMeta(undefined)).toEqual({})
    expect(customRalMeta({ ral: 'nonsense' })).toEqual({})
  })
})

describe('optional RAL option', () => {
  it('lifts the without value out of the suggestions', () => {
    const parts = ralOptionParts(option(['No RAL colour', 'RAL 9016 Traffic white', 'Custom RAL']))
    expect(parts?.off?.id).toBe('v0')
    expect(parts?.suggestions.map((s) => s.value.id)).toEqual(['v1'])
    expect(parts?.custom?.id).toBe('v2')
  })

  it('has no without value when a colour must be chosen', () => {
    expect(ralOptionParts(option(['RAL 9016 Traffic white']))?.off).toBeNull()
  })
})
