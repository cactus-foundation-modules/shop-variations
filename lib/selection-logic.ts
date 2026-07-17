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

// Whether an option value is still reachable, filtered DIRECTIONALLY: at least
// one buyable variant carries this value AND is consistent with every option
// chosen ABOVE this one in display order. Options below it are deliberately
// ignored - a later pick must never hide an earlier option's choices, so the
// shopper can always change an upstream option even when the exact full
// combination they had isn't buyable. The last option, having every other
// option above it, is still filtered to only genuinely buyable finals.
export function isValueAvailable(payload: VariantSelectorPayload, selection: OptionSelection, optionId: string, valueId: string): boolean {
  const v2o = valueToOptionMap(payload)
  const targetIndex = payload.options.findIndex((o) => o.id === optionId)
  return payload.variants.some((variant) => {
    if (!isBuyable(variant)) return false
    if (variantValueForOption(variant, optionId, v2o) !== valueId) return false
    for (let i = 0; i < targetIndex; i++) {
      const o = payload.options[i]
      if (!o) continue
      const sel = selection[o.id]
      if (sel && variantValueForOption(variant, o.id, v2o) !== sel) return false
    }
    return true
  })
}

// Whether an option should currently be shown to the shopper. An option flagged
// `requiresPreviousOption` stays hidden until *every* option before it (in
// display order) has a value chosen - not merely the one immediately before, so
// a dependent option only appears once the whole chain ahead of it is settled.
// The first option is never gated - there is nothing before it to wait on - so a
// flag left on an option later dragged to the front is simply dormant (an empty
// slice is vacuously "all chosen"). A later option that leaves the flag off shows
// straight away regardless of what is or isn't picked above it.
export function isOptionVisible(payload: VariantSelectorPayload, selection: OptionSelection, index: number): boolean {
  const option = payload.options[index]
  if (!option || !option.requiresPreviousOption) return true
  return payload.options.slice(0, index).every((prev) => !!selection[prev.id])
}

// A product page opens with nothing chosen: every option is the shopper's to
// pick, and a combination they never asked for must not be sat in the controls
// (nor, worse, in the price) as though they had. Hence no preselect function
// here - the opening selection is the empty one, and `resolveVariant` above
// already treats that as "no variant yet".
