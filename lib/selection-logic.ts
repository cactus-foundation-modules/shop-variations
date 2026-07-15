// Pure selection maths for the storefront selector - resolving a chosen
// combination to its variant and deciding which option values are still
// selectable/in-stock given the current partial choice. No React, no client
// APIs, so it stays easy to reason about and reuse.
import type { VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'

export type OptionSelection = Record<string, string> // optionId -> chosen option_value_id

// Map every option_value_id to the option it belongs to.
export function valueToOptionMap(payload: VariantSelectorPayload): Map<string, string> {
  const map = new Map<string, string>()
  for (const o of payload.options) for (const v of o.values) map.set(v.id, o.id)
  return map
}

// The value a given variant carries for a given option (undefined if none).
export function variantValueForOption(variant: VariantSelectorVariant, optionId: string, valueToOption: Map<string, string>): string | undefined {
  return variant.optionValueIds.find((id) => valueToOption.get(id) === optionId)
}

// A variant is only "available" to a shopper if it's enabled and in stock.
function isBuyable(v: VariantSelectorVariant): boolean {
  return v.enabled && v.inStock
}

// The variant a full selection resolves to (every option chosen and an exact
// value-set match). Returns null for a partial or non-existent combination.
export function resolveVariant(payload: VariantSelectorPayload, selection: OptionSelection): VariantSelectorVariant | null {
  if (payload.options.length === 0) return null
  if (payload.options.some((o) => !selection[o.id])) return null
  const chosen = payload.options.map((o) => selection[o.id]).sort().join('|')
  return payload.variants.find((v) => [...v.optionValueIds].sort().join('|') === chosen) ?? null
}

// Whether an option value is still reachable: at least one buyable variant
// carries this value AND is consistent with every OTHER already-chosen option.
export function isValueAvailable(payload: VariantSelectorPayload, selection: OptionSelection, optionId: string, valueId: string): boolean {
  const v2o = valueToOptionMap(payload)
  return payload.variants.some((variant) => {
    if (!isBuyable(variant)) return false
    if (variantValueForOption(variant, optionId, v2o) !== valueId) return false
    for (const o of payload.options) {
      if (o.id === optionId) continue
      const sel = selection[o.id]
      if (sel && variantValueForOption(variant, o.id, v2o) !== sel) return false
    }
    return true
  })
}

// The combination to pre-highlight on load: the first buyable variant's values,
// so a real price shows immediately. Falls back to the first enabled variant,
// then to nothing.
export function firstPreselect(payload: VariantSelectorPayload): OptionSelection {
  const v2o = valueToOptionMap(payload)
  const pick = payload.variants.find(isBuyable) ?? payload.variants.find((v) => v.enabled)
  if (!pick) return {}
  const selection: OptionSelection = {}
  for (const o of payload.options) {
    const val = variantValueForOption(pick, o.id, v2o)
    if (val) selection[o.id] = val
  }
  return selection
}
