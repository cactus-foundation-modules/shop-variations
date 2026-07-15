// Single source of truth for personalisation pricing, validation and display
// normalisation. The storefront uses it for the indicative live price; the
// server line resolver uses the exact same function for the authoritative price
// and the persisted meta, so the two can never disagree. Pure and server-safe.
import type { SvrAddon } from '@/modules/shop-variations/lib/types'
import type { LineMetaField } from '@/modules/shop/lib/types'

// A file value carries its stored filename and, once resolved server-side, a
// download url (rendered as a link in the persisted meta).
export type AddonFileValue = { token: string; filename: string; url?: string }
export type AddonValue = string | number | boolean | AddonFileValue | null | undefined

export type AddonPricingResult = {
  priceAdjust: number
  valid: boolean
  reason?: string
  fields: LineMetaField[]
}

function isFilled(addon: SvrAddon, value: AddonValue): boolean {
  if (value == null) return false
  if (addon.type === 'CHECKBOX') return value === true
  if (addon.type === 'FILE') return typeof value === 'object' && !!(value as AddonFileValue).token
  return String(value).trim().length > 0
}

function displayValue(addon: SvrAddon, value: AddonValue): { text: string; href?: string } {
  if (addon.type === 'CHECKBOX') return { text: 'Yes' }
  if (addon.type === 'FILE') {
    const f = value as AddonFileValue
    return { text: f.filename, href: f.url }
  }
  if (addon.type === 'SELECT') {
    const choice = addon.config.choices?.find((c) => c.value === value)
    return { text: choice?.label ?? String(value) }
  }
  return { text: String(value) }
}

// round to 2dp - keep in step with shop's money maths so the indicative and
// charged surcharge never drift a penny.
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function computeAddonPricing(addons: SvrAddon[], values: Record<string, AddonValue>): AddonPricingResult {
  let priceAdjust = 0
  const fields: LineMetaField[] = []

  for (const addon of addons) {
    const value = values[addon.id]
    const filled = isFilled(addon, value)

    if (addon.required && !filled) {
      return { priceAdjust: 0, valid: false, reason: `${addon.label} is required`, fields: [] }
    }
    if (!filled) continue

    // Per-type validation.
    if ((addon.type === 'TEXT' || addon.type === 'TEXTAREA') && addon.config.maxLength != null) {
      if (String(value).length > addon.config.maxLength) {
        return { priceAdjust: 0, valid: false, reason: `${addon.label} is too long (max ${addon.config.maxLength})`, fields: [] }
      }
    }
    if (addon.type === 'NUMBER') {
      const n = Number(value)
      if (Number.isNaN(n)) return { priceAdjust: 0, valid: false, reason: `${addon.label} must be a number`, fields: [] }
      if (addon.config.min != null && n < addon.config.min) return { priceAdjust: 0, valid: false, reason: `${addon.label} must be at least ${addon.config.min}`, fields: [] }
      if (addon.config.max != null && n > addon.config.max) return { priceAdjust: 0, valid: false, reason: `${addon.label} must be at most ${addon.config.max}`, fields: [] }
    }
    if (addon.type === 'SELECT') {
      const choice = addon.config.choices?.find((c) => c.value === value)
      if (!choice) return { priceAdjust: 0, valid: false, reason: `Choose a valid option for ${addon.label}`, fields: [] }
      if (choice.price) priceAdjust += choice.price
    }

    // Pricing common to all types.
    if (addon.config.flatPrice) priceAdjust += addon.config.flatPrice
    if ((addon.type === 'TEXT' || addon.type === 'TEXTAREA') && addon.config.pricePerChar) {
      priceAdjust += addon.config.pricePerChar * String(value).trim().length
    }

    const disp = displayValue(addon, value)
    fields.push({ label: addon.label, value: disp.text, ...(disp.href ? { href: disp.href } : {}) })
  }

  return { priceAdjust: round2(priceAdjust), valid: true, fields }
}
