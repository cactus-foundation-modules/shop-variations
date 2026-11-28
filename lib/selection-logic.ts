// Pure selection maths for the storefront selector - resolving a chosen
// combination to its variant and deciding which option values are still
// selectable/in-stock given the current partial choice. No React, no client
// APIs, so it stays easy to reason about and reuse.
import type { VariantSelectorPayload, VariantSelectorVariant } from '@/modules/shop-variations/lib/types'
import { isWithoutLabel } from '@/modules/shop-variations/lib/without-label'

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

// The variations a part-made selection could still become, in the owner's matrix
// order: switched on, and answering to every pick made so far. The gallery leads
// with the first of these that has pictures (or a model) of its own, so picking a
// finish shows that finish before the size is settled. Empty with nothing picked -
// the opening view is the owner's, not the first row of the matrix.
//
// Stock is deliberately not a filter. This chooses what to LOOK at, and a
// sold-out walnut desk is still what walnut looks like; leaving it out would show
// the shopper a second-best photograph for no reason they could see.
export function previewVariants(payload: VariantSelectorPayload, selection: OptionSelection): VariantSelectorVariant[] {
  const picks = payload.options.flatMap((o) => (selection[o.id] ? [{ optionId: o.id, valueId: selection[o.id]! }] : []))
  if (picks.length === 0) return []
  const v2o = valueToOptionMap(payload)
  return payload.variants.filter((variant) =>
    variant.enabled && picks.every((p) => variantAnswersTo(variant, p.optionId, p.valueId, v2o)),
  )
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

// Whether picking a given option value could land the shopper on a reduced
// price: some buyable combination that carries it, and agrees with every pick
// made ABOVE it, is on offer. Same directional filter as valuePriceRange, and
// for the same reason - a later choice must never change what an earlier option
// says about itself.
//
// "On offer" is the variant's own compareAtPrice sitting above what it is
// actually charged. That figure is worked out server-side by shop's
// effectivePrice, so this cannot disagree with the money printed beside the buy
// button. Half a penny of tolerance so floating-point crumbs cannot invent a
// saving out of two identical figures.
export function valueOnSale(
  payload: VariantSelectorPayload,
  selection: OptionSelection,
  optionId: string,
  valueId: string,
): boolean {
  const v2o = valueToOptionMap(payload)
  const targetIndex = payload.options.findIndex((o) => o.id === optionId)
  for (const variant of payload.variants) {
    if (!isBuyable(payload, variant)) continue
    if (variant.compareAtPrice == null || variant.compareAtPrice - variant.price <= 0.005) continue
    if (!variantAnswersTo(variant, optionId, valueId, v2o)) continue
    let agrees = true
    for (let i = 0; i < targetIndex; i++) {
      const o = payload.options[i]
      if (!o) continue
      const sel = selection[o.id]
      if (sel && !variantAnswersTo(variant, o.id, sel, v2o)) { agrees = false; break }
    }
    if (agrees) return true
  }
  return false
}

// Whether THIS option is where the offer is decided: some of its reachable
// values lead to a reduced price and some do not. What the "Sale" badge over an
// option's name answers - on a product where only certain variations are
// discounted, it points at the choice that carries the offer rather than leaving
// the shopper to click through every combination hunting for it.
//
// Deliberately NOT "any of them is on offer". Where every reachable value leads
// to a reduction the option decides nothing about the money: badge every option
// on a wholly discounted product and the badges say only what the struck-through
// price beside the buy button already says, on the one product where they are
// least use. The option that actually narrows it - the size, say, where only one
// is on clearance - is the only one that comes out true, whichever other options
// sit above or below it.
export function optionHasSale(payload: VariantSelectorPayload, selection: OptionSelection, optionId: string): boolean {
  const option = payload.options.find((o) => o.id === optionId)
  if (!option) return false
  let reachable = 0
  let reduced = 0
  for (const v of option.values) {
    // Reachable on the same directional terms as everything else here: something
    // buyable carries it and agrees with the picks above. An out-of-reach value
    // is not a choice the shopper has, so it cannot be the reason a badge does
    // or does not appear.
    if (!valuePriceRange(payload, selection, optionId, v.id)) continue
    reachable += 1
    if (valueOnSale(payload, selection, optionId, v.id)) reduced += 1
  }
  return reduced > 0 && reduced < reachable
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

// The two halves of a tick-box option: the value an unticked box stands for (the
// "without") and the value ticking it picks (the extra). Null unless the option is
// a tick box with exactly two values - anything else has no honest yes-or-no
// reading, and the storefront draws it as ordinary pills instead.
//
// The "without" is the value whose label says so - "No", "None", "Without
// headrest", "No module" - wherever it sits in the list, so an owner who typed Yes
// before No still gets the right box. Where neither label reads that way, the
// first value in the owner's order is the unticked one.
export function tickBoxValues<V extends { id: string; label: string }>(
  option: { controlType: string; values: V[] },
): { off: V; on: V } | null {
  if (option.controlType !== 'CHECKBOX' || option.values.length !== 2) return null
  const [first, second] = option.values
  if (!first || !second) return null
  const firstIsOff = isWithoutLabel(first.label) || !isWithoutLabel(second.label)
  return firstIsOff ? { off: first, on: second } : { off: second, on: first }
}

// An unticked box is an answer, not a gap: the shopper who leaves the power module
// off has chosen "without" as surely as one who picked a size has chosen a size.
// So every tick-box option nobody has touched is filled with its "without" value -
// and so is an optional RAL option (one with a "No RAL colour" value, see
// lib/ral-option.ts) whose box the shopper has not ticked -
// provided that value can be had with the picks above it, matching
// isValueAvailable's directional filter. Where it cannot (every variation carries
// the extra), the option is left empty and withAutoSelected settles it on the one
// value that remains, which draws as a box ticked for the shopper.
//
// Runs top-down so a filled box counts as chosen for the options beneath it - an
// option waiting on "every option above it" (isOptionVisible) is not held back by
// a box the shopper has no reason to touch. Pure - hands back a new selection.
//
// `opened` names the optional RAL options whose box the shopper HAS ticked: those
// are left empty, so the colour is theirs to choose and the buy button waits.
export function withTickBoxDefaults(payload: VariantSelectorPayload, selection: OptionSelection, opened: ReadonlySet<string> = new Set()): OptionSelection {
  let next = selection
  for (const option of payload.options) {
    if (next[option.id]) continue
    const off = tickBoxValues(option)?.off ?? (opened.has(option.id) ? null : optionalOff(option))
    if (!off) continue
    if (isValueAvailable(payload, next, option.id, off.id)) next = { ...next, [option.id]: off.id }
  }
  return next
}

// The value an option falls back to while its "opt in" box is unticked: the
// "No RAL colour" of an optional RAL option, or the "No module" of a tick box
// with several choices behind it (tickBoxChoices). Null for anything that must
// simply be answered. The RAL half is read the same way lib/ral-option.ts reads
// it; kept here as well, rather than imported, because that file imports the
// chart and selection logic stays free of it.
export function optionalOff<V extends { id: string; label: string }>(option: { controlType: string; values: V[] }): V | null {
  if (option.controlType === 'RAL') return option.values.find((v) => isWithoutLabel(v.label)) ?? null
  return tickBoxChoices(option)?.off ?? null
}

// A tick box with more than one extra behind it: "No module", then White and
// Black. The box opts in, and the choices appear under it to pick exactly one
// from - unticking puts the "without" value back. Needs three or more values,
// one of which says "without" (isWithoutLabel); a plain two-value tick box is
// tickBoxValues' job, and a pile of values with no "without" among them has no
// honest unticked state, so it is null and draws as pills.
export function tickBoxChoices<V extends { id: string; label: string }>(
  option: { controlType: string; values: V[] },
): { off: V; choices: V[] } | null {
  if (option.controlType !== 'CHECKBOX' || option.values.length < 3) return null
  const off = option.values.find((v) => isWithoutLabel(v.label))
  if (!off) return null
  return { off, choices: option.values.filter((v) => v.id !== off.id) }
}
