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

// Whether a variant answers to a given value of a given option - the value it
// actually carries, or one it stands in for.
//
// An alias says two values of one option describe the same product, so the choice
// between them changes nothing about what arrives: a chair whose back is black AND
// matches its black seat is one chair and one SKU, however the shopper words it.
// Without this the second wording had no variant to point at and greyed out.
//
// Every availability, pricing and explanation function below asks the question
// through here rather than comparing ids itself, so all of them agree about what a
// variant can answer to. resolveVariant is the deliberate exception: it settles the
// exact match first and only then allows aliases, so an alias can fill a hole but
// never shadow a combination some other variation genuinely carries.
export function variantAnswersTo(
  variant: VariantSelectorVariant,
  optionId: string,
  valueId: string,
  valueToOption: Map<string, string>,
): boolean {
  if (variantValueForOption(variant, optionId, valueToOption) === valueId) return true
  return (variant.aliasValueIds ?? []).some((id) => id === valueId && valueToOption.get(id) === optionId)
}

// A variant is only "available" to a shopper if it's enabled and in stock.
//
// Staff are held to the first half only: they may still pick a combination the
// shelf has run dry on, because the point of the storefront for them is to check
// and demonstrate the product rather than buy it - and a picker that refuses to
// show an owner their own sold-out colour is no use for either. `showStockCounts`
// is that staff flag, already on the payload for the stock figures and already
// resolved per request on the server (shop's canSeeStockLevels), so it cannot be
// forged from the browser or served to a shopper out of a shared cache.
//
// `enabled` binds staff exactly as it binds everyone: a switched-off variation is
// the owner's own decision that the combination does not exist, not the warehouse's.
function isBuyable(payload: VariantSelectorPayload, v: VariantSelectorVariant): boolean {
  return v.enabled && (v.inStock || payload.showStockCounts === true)
}

// The variant a full selection resolves to (every option chosen and an exact
// value-set match). Returns null for a partial or non-existent combination.
//
// Exact first, always. Only when nothing carries the chosen combination outright
// is a variation allowed to answer for it by alias - so a product where both
// wordings have a real variation of their own behaves exactly as it did, and the
// alias is confined to the hole it was added to fill.
export function resolveVariant(payload: VariantSelectorPayload, selection: OptionSelection): VariantSelectorVariant | null {
  if (payload.options.length === 0) return null
  if (payload.options.some((o) => !selection[o.id])) return null
  const chosen = payload.options.map((o) => selection[o.id]).sort().join('|')
  const exact = payload.variants.find((v) => [...v.optionValueIds].sort().join('|') === chosen)
  if (exact) return exact
  // Nothing aliased on this product: the exact miss above is the whole answer, and
  // the second pass would only cost every product in the shop a wasted scan.
  if (!payload.variants.some((v) => (v.aliasValueIds ?? []).length > 0)) return null
  const v2o = valueToOptionMap(payload)
  // Answering for EVERY option, which also rules out a variation that simply has
  // no value for one of them: a half-described variation must not be dragged in
  // just because the values it does carry happen to agree.
  return payload.variants.find((v) =>
    payload.options.every((o) => {
      const sel = selection[o.id]
      return !!sel && variantAnswersTo(v, o.id, sel, v2o)
    }),
  ) ?? null
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
    if (!isBuyable(payload, variant)) return false
    if (!variantAnswersTo(variant, optionId, valueId, v2o)) return false
    for (let i = 0; i < targetIndex; i++) {
      const o = payload.options[i]
      if (!o) continue
      const sel = selection[o.id]
      if (sel && !variantAnswersTo(variant, o.id, sel, v2o)) return false
    }
    return true
  })
}

// Prune a raw selection down to the picks that are still reachable, walking
// top-down so an upstream value going unreachable frees the options below it
// rather than dragging them down as well. Each pick is kept only if it is still
// available given the picks kept ABOVE it - matching isValueAvailable's
// directional filter. The result is the selection the maths should reason about
// (variant, price, availability); the raw one is kept alongside only so a
// control can still show a now-unreachable pick struck through (see
// `ghostValue` in use-variation-selection).
export function effectiveSelection(payload: VariantSelectorPayload, raw: OptionSelection): OptionSelection {
  const kept: OptionSelection = {}
  for (const option of payload.options) {
    const value = raw[option.id]
    if (value && isValueAvailable(payload, kept, option.id, value)) kept[option.id] = value
  }
  return kept
}

// Like effectiveSelection, but where a change above has stranded an option the
// shopper HAD chosen, fill it with the first value still available to it rather
// than leaving it empty - so a valid combination is kept in hand at all times.
// The shopper's own raw pick is never touched (it stays the "ghost" shown struck
// through); only the derived selection carries the stand-in, so reverting the
// upstream change restores their original picks untouched.
//
// Works top-down, one option at a time: prune the raw picks, fill the first
// stranded option, then re-prune - because settling that option can in turn
// strand one below it, exactly as a manual pick would cascade. An option the
// shopper never chose is left empty for them to pick (single-value settling of
// those is withAutoSelected's job). The fill is always chosen against the picks
// kept ABOVE it, matching isValueAvailable's directional filter, so the result is
// a genuinely buyable combination and not a directional near-miss.
export function withStrandedFilled(payload: VariantSelectorPayload, raw: OptionSelection): OptionSelection {
  let working = raw
  // Bounded by the option count: each pass settles one more option for good.
  for (let guard = 0; guard <= payload.options.length; guard++) {
    const effective = effectiveSelection(payload, working)
    let target = -1
    for (let i = 0; i < payload.options.length; i++) {
      const option = payload.options[i]
      if (!option || effective[option.id]) continue // still has a reachable pick
      if (!raw[option.id]) continue // never chosen - leave for the shopper
      if (!payload.options.slice(0, i).every((prev) => !!effective[prev.id])) continue // wait on upstream
      target = i
      break
    }
    if (target < 0) return effective
    const option = payload.options[target]
    if (!option) return effective
    const first = option.values.find((v) => isValueAvailable(payload, effective, option.id, v.id))
    if (!first) return effective // nothing available to stand in - leave it empty
    working = { ...effective, [option.id]: first.id }
  }
  return effectiveSelection(payload, working)
}

// What a shopper could still end up paying if they picked a given option value,
// as the cheapest and dearest buyable combination that carries it and agrees with
// every pick made ABOVE it - the same directional filter isValueAvailable uses,
// so the figures describe exactly the choices the control is offering. Null when
// nothing buyable carries the value, which is the same case that greys it out.
//
// Deliberately ignores the picks BELOW the option, for the same reason
// isValueAvailable does: a later choice must never change what an earlier option
// says it costs, or the price under a value would jump about as the shopper works
// down the list.
export function valuePriceRange(
  payload: VariantSelectorPayload,
  selection: OptionSelection,
  optionId: string,
  valueId: string,
): { min: number; max: number } | null {
  const v2o = valueToOptionMap(payload)
  const targetIndex = payload.options.findIndex((o) => o.id === optionId)
  let min = Infinity
  let max = -Infinity
  for (const variant of payload.variants) {
    if (!isBuyable(payload, variant)) continue
    if (!variantAnswersTo(variant, optionId, valueId, v2o)) continue
    let agrees = true
    for (let i = 0; i < targetIndex; i++) {
      const o = payload.options[i]
      if (!o) continue
      const sel = selection[o.id]
      if (sel && !variantAnswersTo(variant, o.id, sel, v2o)) { agrees = false; break }
    }
    if (!agrees) continue
    if (variant.price < min) min = variant.price
    if (variant.price > max) max = variant.price
  }
  return min === Infinity ? null : { min, max }
}

// Whether THIS option is one that moves the money: its reachable values do not
// all start from the same figure. Where they do, printing a price under every
// value would say the same thing four times and tell the shopper nothing, so the
// controls only show the hint when this is true. Half a penny of tolerance so
// floating-point crumbs cannot invent a difference out of identical figures.
export function optionAffectsPrice(payload: VariantSelectorPayload, selection: OptionSelection, optionId: string): boolean {
  const option = payload.options.find((o) => o.id === optionId)
  if (!option) return false
  const floors: number[] = []
  for (const value of option.values) {
    const range = valuePriceRange(payload, selection, optionId, value.id)
    if (range) floors.push(range.min)
  }
  if (floors.length < 2) return false
  return Math.max(...floors) - Math.min(...floors) > 0.005
}

// The chosen upstream value(s) that make a given option value unreachable, as a
// human label for a tooltip ("Not available with Oak, Large"). An upstream pick
// is a culprit when no buyable variant carries both it and the target value.
// Empty string when the clash needs a combination of picks rather than any
// single one - the caller falls back to a generic message.
export function unavailableWith(payload: VariantSelectorPayload, selection: OptionSelection, optionId: string, valueId: string): string {
  const v2o = valueToOptionMap(payload)
  const targetIndex = payload.options.findIndex((o) => o.id === optionId)
  const labels: string[] = []
  for (let i = 0; i < targetIndex; i++) {
    const o = payload.options[i]
    if (!o) continue
    const sel = selection[o.id]
    if (!sel) continue
    const coexists = payload.variants.some((variant) =>
      isBuyable(payload, variant) &&
      variantAnswersTo(variant, optionId, valueId, v2o) &&
      variantAnswersTo(variant, o.id, sel, v2o),
    )
    if (!coexists) {
      const lbl = o.values.find((x) => x.id === sel)?.label
      if (lbl) labels.push(lbl)
    }
  }
  return labels.join(', ')
}

// Whether every variation carrying this value is out of stock. Deliberately
// blind to the shopper's selection: the question is about the value itself, so
// a colour the supplier has run dry on says so however the rest of the picker
// stands. Worth telling apart from the generic wording, because "out of stock"
// is an answer a shopper can act on ("come back later") and "unavailable" is a
// shrug.
//
// False when nothing carries the value at all - there is no stock to be out of -
// and false when a carrier is merely switched off while holding stock, which is
// the shop owner's doing rather than the warehouse's.
export function isValueOutOfStock(payload: VariantSelectorPayload, optionId: string, valueId: string): boolean {
  const v2o = valueToOptionMap(payload)
  const carriers = payload.variants.filter((variant) => variantAnswersTo(variant, optionId, valueId, v2o))
  if (carriers.length === 0) return false
  return carriers.every((variant) => !variant.inStock)
}

// The mirror of unavailableWith: not which pick rules a value out, but which
// picks would bring it back. For every chosen upstream value that rules the
// target out on its own, the values of that same option which WOULD allow it, in the
// option's own display order.
export type AvailableWithGroup = {
  optionId: string
  optionName: string
  labels: string[]
  // Whether those values are one unbroken run of the option's display order, so
  // a caller may collapse them to "160 to 180cm" instead of listing each. False
  // for a gappy set, which has to be listed in full or the summary would promise
  // a combination that isn't on offer.
  contiguous: boolean
}

// Empty when no single upstream pick is the culprit - a clash that needs a
// combination of picks, or a value nothing buyable carries at all. The caller
// falls back to a bare "unavailable" there rather than inventing a reason.
export function availableWith(
  payload: VariantSelectorPayload,
  selection: OptionSelection,
  optionId: string,
  valueId: string,
): AvailableWithGroup[] {
  const v2o = valueToOptionMap(payload)
  const targetIndex = payload.options.findIndex((o) => o.id === optionId)
  if (targetIndex < 0) return []
  // The upstream picks that, on their own, rule the target value out - exactly
  // the ones unavailableWith names.
  const culprits: number[] = []
  for (let i = 0; i < targetIndex; i++) {
    const o = payload.options[i]
    if (!o) continue
    const sel = selection[o.id]
    if (!sel) continue
    const coexists = payload.variants.some((variant) =>
      isBuyable(payload, variant) &&
      variantAnswersTo(variant, optionId, valueId, v2o) &&
      variantAnswersTo(variant, o.id, sel, v2o),
    )
    if (!coexists) culprits.push(i)
  }
  const groups: AvailableWithGroup[] = []
  for (const index of culprits) {
    const option = payload.options[index]
    if (!option) continue
    // Held against the upstream picks that are NOT culprits: those the shopper
    // could keep. Relaxing this option is the change being described, and
    // relaxing the other culprits too is implied by them getting their own group.
    const indices: number[] = []
    option.values.forEach((value, valueIndex) => {
      const works = payload.variants.some((variant) => {
        if (!isBuyable(payload, variant)) return false
        if (!variantAnswersTo(variant, optionId, valueId, v2o)) return false
        if (!variantAnswersTo(variant, option.id, value.id, v2o)) return false
        for (let i = 0; i < targetIndex; i++) {
          if (culprits.includes(i)) continue
          const other = payload.options[i]
          if (!other) continue
          const sel = selection[other.id]
          if (sel && !variantAnswersTo(variant, other.id, sel, v2o)) return false
        }
        return true
      })
      if (works) indices.push(valueIndex)
    })
    if (indices.length === 0) continue
    const first = indices[0] ?? 0
    const contiguous = indices.every((n, k) => n === first + k)
    groups.push({
      optionId: option.id,
      optionName: option.name,
      labels: indices.map((n) => option.values[n]?.label ?? '').filter(Boolean),
      contiguous,
    })
  }
  return groups
}

// Two labels that end in a number and the same unit ("160cm", "180cm") read as a
// range with the unit said once, which is how a shopper would say it out loud:
// the opening label with its unit trimmed off, ready for "… to 180cm". Null for
// anything that isn't a pair of measurements - "Oak to Walnut" is not a range, it
// is two colours with a word between them, so those get listed out instead.
function rangeStart(first: string, last: string): string | null {
  const a = /^(.*[0-9])([^0-9]*)$/.exec(first)
  const b = /^(.*[0-9])([^0-9]*)$/.exec(last)
  if (a && b && a[1] && a[2] === b[2]) return a[1]
  return null
}

// One phrase per group of values, before any preposition is put in front of it:
// "160 to 180cm" for an unbroken run of three or more, otherwise the labels
// listed out ("160cm or 180cm").
function groupPhrases(groups: AvailableWithGroup[]): string[] {
  return groups.map((group) => {
    const labels = group.labels
    const first = labels[0]
    const last = labels[labels.length - 1]
    if (!first || !last) return ''
    if (labels.length === 1) return first
    if (labels.length >= 3 && group.contiguous) {
      const start = rangeStart(first, last)
      if (start) return `${start} to ${last}`
    }
    return `${labels.slice(0, -1).join(', ')} or ${last}`
  }).filter(Boolean)
}

// A value whose own label is already a preposition phrase - "With Headrest",
// "Without Arms" - carries its own grammar, and "available in With Headrest" is
// not English. Those take no "in"; everything else does.
function carriesOwnPreposition(phrase: string): boolean {
  return /^with(out)?\b/i.test(phrase)
}

// The whole line printed under an out-of-reach choice: "available in 160 to
// 180cm", or "available With Headrest" where the value says its own preposition.
// Empty string when there's nothing honest to say, which is the caller's cue to
// fall back to a plain "unavailable".
//
// Where two options both have to move, only the FIRST plain phrase takes the
// "in" - "available in 160 to 180cm and Oak", not "…and in Oak" - since one
// preposition already governs the list. A phrase carrying its own never takes it
// and never spends the one going, so "available With Headrest and in 160 to
// 180cm" still reads.
export function availableWithPhrase(groups: AvailableWithGroup[]): string {
  let inSpent = false
  const parts = groupPhrases(groups).map((phrase) => {
    if (carriesOwnPreposition(phrase)) return phrase
    if (inSpent) return phrase
    inSpent = true
    return `in ${phrase}`
  })
  return parts.length === 0 ? '' : `available ${parts.join(' and ')}`
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

// Once every option above it is settled, an option with a single reachable value
// has nothing left for the shopper to decide - so choose it for them. This runs
// after each pick and cascades top-down: settling option A may leave B with one
// value, which settles C, and so on until nothing more resolves. It only ever
// fires for an option whose every predecessor is already chosen, matching
// isValueAvailable's directional filter and never pre-empting an upstream choice
// the shopper still has to make. Pure - hands back a new selection, mutates
// nothing.
export function withAutoSelected(payload: VariantSelectorPayload, selection: OptionSelection): OptionSelection {
  let next = selection
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < payload.options.length; i++) {
      const option = payload.options[i]
      if (!option || next[option.id]) continue
      if (!payload.options.slice(0, i).every((prev) => !!next[prev.id])) continue
      const available = option.values.filter((v) => isValueAvailable(payload, next, option.id, v.id))
      const only = available[0]
      if (available.length === 1 && only) {
        next = { ...next, [option.id]: only.id }
        changed = true
      }
    }
  }
  return next
}

// A product page opens with nothing chosen: every option is the shopper's to
// pick, and a combination they never asked for must not be sat in the controls
// (nor, worse, in the price) as though they had. Hence no preselect function
// here - the opening selection is the empty one, and `resolveVariant` above
// already treats that as "no variant yet".
