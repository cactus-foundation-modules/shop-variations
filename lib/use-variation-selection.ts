'use client'

// Selection store + hook shared by the composite block and every granular part.
// Keyed by product slug so parts dropped independently into a layout still sync
// (there's no guaranteed common React ancestor to hold a context). A tiny pub/sub
// keeps islands in step - the same approach the cart uses for cross-island
// updates.
//
// The payload arrives one of two ways. Normally an RSC block half resolves it
// while the page renders and passes it in as `initial`, and the controls are in
// the HTML the shopper's browser receives. Where the server couldn't work out
// which product it is, the hook falls back to fetching it after mount, which is
// what it used to do in every case - and what made the options turn up a beat
// after everything else.
import { useEffect, useState } from 'react'
import { computeAddonPricing, type AddonValue } from '@/modules/shop-variations/lib/addon-pricing'
import { resolveVariant, isValueAvailable, isValueOutOfStock, isOptionVisible, withAutoSelected, withStrandedFilled, unavailableWith, availableWith, availableWithPhrase, valueToOptionMap, valuePriceRange, optionAffectsPrice, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'
import { addToCart } from '@/modules/shop/components/public/cart'
import { publishVariantSelection } from '@/modules/shop-variations/lib/selection-broadcast'
import { collectPurchaseCompanions } from '@/modules/shop-variations/lib/purchase-companions'
import type { VariantSelectorPayload, VariationBootstrap } from '@/modules/shop-variations/lib/types'

type Entry = {
  slug: string
  payload: VariantSelectorPayload | null
  loaded: boolean
  fetching: boolean
  optionValues: OptionSelection
  addonValues: Record<string, AddonValue>
  // Set when the entry was seeded from a server-resolved payload, which carries
  // the shop's symbol with it. Null on the fetch path, where the symbol is a
  // page-wide lookup rather than a per-product one - hence the fallback below.
  currencySymbol: string | null
  // Bumped every time the shopper presses Reset options. An island that showed
  // something CHOSEN - the variation's own photograph, its 3D model - has to put
  // it away again on a reset, and "the picks are empty" is not the same question:
  // a page opens empty too, and a gallery must not tear its opening view down for
  // that. A counter rather than a flag, so an island watches it as an effect
  // dependency and there is nothing to clear afterwards.
  resetEpoch: number
  subs: Set<() => void>
}

const store = new Map<string, Entry>()
let currencySymbol = '£'
let currencyFetched = false

// This module's state is per-tab in the browser and per-process on the server,
// where it outlives the request and is shared by every shopper the instance
// serves. So nothing here may be written during a server render: an entry seeded
// into `store` on the server would still be sat there, marked loaded, for the
// next render of that product - handing out whatever price and stock this render
// happened to see until the instance recycled. Server renders therefore work off
// a throwaway entry (see `useVariationSelection`) and touch none of the above.
const isServer = typeof window === 'undefined'

function newEntry(slug: string): Entry {
  return { slug, payload: null, loaded: false, fetching: false, optionValues: {}, addonValues: {}, currencySymbol: null, resetEpoch: 0, subs: new Set() }
}

// Turn a flat list of option-value ids (a deep-linked variant's combination)
// into the store's optionId -> valueId shape, dropping any value the payload's
// options don't carry. This seeds the opening selection when a page is reached
// through a variant's own deep link.
function optionValuesFromValueIds(payload: VariantSelectorPayload, valueIds: string[]): OptionSelection {
  const valueToOption = valueToOptionMap(payload)
  const selection: OptionSelection = {}
  for (const valueId of valueIds) {
    const optionId = valueToOption.get(valueId)
    if (optionId) selection[optionId] = valueId
  }
  return selection
}

// An entry that already holds everything the server resolved: no fetch to do and
// no empty first render. The options normally open unchosen (see selection-logic),
// so the controls arrive in the HTML with nothing picked in them - unless the
// bootstrap carries a deep link's preselection, in which case they open on that
// combination, the same picks the shopper would have made by hand.
function seededEntry(slug: string, bootstrap: VariationBootstrap): Entry {
  const entry = newEntry(slug)
  entry.payload = bootstrap.payload
  entry.currencySymbol = bootstrap.currencySymbol
  entry.loaded = true
  if (bootstrap.preselectOptionValueIds && bootstrap.preselectOptionValueIds.length > 0) {
    entry.optionValues = optionValuesFromValueIds(bootstrap.payload, bootstrap.preselectOptionValueIds)
  }
  return entry
}

function getEntry(slug: string): Entry {
  let entry = store.get(slug)
  if (!entry) {
    entry = newEntry(slug)
    store.set(slug, entry)
  }
  return entry
}

function notify(entry: Entry): void {
  for (const cb of entry.subs) cb()
}

async function ensureLoaded(entry: Entry): Promise<void> {
  if (entry.loaded || entry.fetching) return
  entry.fetching = true
  if (!currencyFetched) {
    currencyFetched = true
    fetch('/api/m/shop/public/config').then(async (r) => { if (r.ok) { currencySymbol = (await r.json()).currencySymbol ?? '£'; notify(entry) } }).catch(() => {})
  }
  try {
    const res = await fetch(`/api/m/shop-variations/public/by-slug/${encodeURIComponent(entry.slug)}/variations`)
    entry.payload = res.ok ? await res.json() : null
  } catch {
    entry.payload = null
  } finally {
    entry.fetching = false
    entry.loaded = true
    notify(entry)
  }
}

// Puts a server-resolved payload into the browser's store, so the first render
// after hydration has the options, the price and the preselected combination
// already in hand and ensureLoaded finds nothing left to fetch.
//
// Runs during render rather than in an effect, and deliberately: an effect fires
// after paint, which is the pause this whole exercise is about. Safe to call on
// every render - the first seed for a slug wins, so a re-render can never
// discard a selection the shopper has since made.
function seedVariationSelection(slug: string, bootstrap: VariationBootstrap): void {
  const existing = store.get(slug)
  if (existing && (existing.loaded || existing.fetching)) return
  const entry = seededEntry(slug, bootstrap)
  // Carry over anything an unseeded island already collected for this slug.
  if (existing) {
    entry.addonValues = existing.addonValues
    entry.resetEpoch = existing.resetEpoch
    for (const cb of existing.subs) entry.subs.add(cb)
  }
  store.set(slug, entry)
  // The shop's symbol came down with the payload, so the config fetch is moot.
  // Setting the flag too stops an unseeded island firing it off regardless.
  currencySymbol = bootstrap.currencySymbol
  currencyFetched = true
}

export function setOptionValue(slug: string, optionId: string, valueId: string): void {
  const entry = getEntry(slug)
  // Set the changed option and keep every other pick exactly as it stands -
  // above AND below. Nothing is wiped or settled here: this store holds only the
  // shopper's own raw picks. A downstream pick the change has stranded stays put
  // so the control can still show it struck through, and the single-choice
  // auto-settle is derived when the hook reads this back (see
  // useVariationSelection) rather than baked in here. Keeping it out of the store
  // is deliberate: an auto-picked stand-in must never overwrite - and so erase -
  // the stranded pick it is standing in for, or the shopper would lose sight of
  // the choice that no longer fits.
  entry.optionValues = { ...entry.optionValues, [optionId]: valueId }
  notify(entry)
}

// Back to the opening state: every option unchosen, so the price falls back to
// the parent's and the buy button waits to be told what to sell. Personalisation
// is left alone - it's the shopper's own typing, not a pick they can redo in a
// click, and binning it because they changed their mind about a colour would be
// its own small outrage.
export function resetOptionValues(slug: string): void {
  const entry = getEntry(slug)
  entry.optionValues = {}
  entry.resetEpoch += 1
  notify(entry)
}

export function setAddonValue(slug: string, addonId: string, value: AddonValue): void {
  const entry = getEntry(slug)
  entry.addonValues = { ...entry.addonValues, [addonId]: value }
  notify(entry)
}

// Stable line id so re-adding an identical personalised selection merges, while
// different inputs (or unique upload tokens) stay separate lines.
// Accepts the whole main-line meta bag (personalisation values and any
// companion-stamped state alike): every entry is JSON-serialisable by the cart's
// own rules, so the same recipe - sorted keys, stringified pairs - keys them all.
function stableKey(childId: string, values: Record<string, unknown>): string {
  const keys = Object.keys(values).sort()
  return `${childId}:${JSON.stringify(keys.map((k) => [k, values[k]]))}`
}

export type VariationSelection = ReturnType<typeof useVariationSelection>

// `initial` is the server-resolved payload, passed down by an RSC block half.
// Given one, this hook never fetches and never renders an empty state: the
// options are in the entry before the first read below. Without one (a layout
// that renders our blocks somewhere the server couldn't identify the product)
// it behaves exactly as it always has, fetching after mount.
export function useVariationSelection(slug: string | null, initial?: VariationBootstrap | null) {
  const [, force] = useState(0)

  // Server: a throwaway entry, so the HTML is rendered from this request's own
  // payload and the shared store is left untouched (see `isServer` above).
  // Browser: seed the shared store, so every island on the page reads the same
  // selection and stays in step as the shopper changes it.
  let entry: Entry | undefined
  if (slug && isServer) {
    entry = initial ? seededEntry(slug, initial) : undefined
  } else if (slug) {
    if (initial) seedVariationSelection(slug, initial)
    entry = store.get(slug)
  }

  useEffect(() => {
    if (!slug) return
    const live = getEntry(slug)
    const cb = () => force((n) => n + 1)
    live.subs.add(cb)
    ensureLoaded(live)
    return () => { live.subs.delete(cb) }
  }, [slug])

  const payload = entry?.payload ?? null
  // Raw holds every pick the shopper has made, including any left stranded (and
  // unreachable) by a later change to an option above it. `selection` is the raw
  // map pruned to just the picks still reachable - the one the maths reasons
  // about. The gap between the two is a "ghost": a pick shown struck through so
  // the shopper sees what was there and why it no longer fits, rather than a
  // control silently emptying itself.
  const rawOptionValues = entry?.optionValues ?? {}
  // Prune the raw picks to the ones still reachable; where a change above has
  // stranded an option the shopper had chosen, stand in its first available value
  // so a valid combination is always in hand (the stranded pick stays as a ghost,
  // struck through - see below). Then settle any option a pick has narrowed to a
  // single choice (cascading downward). Both steps are gated on the shopper having
  // actually picked something: an untouched page opens unchosen, showing the
  // parent's price, and must not quietly pick a first option for them.
  const effective = payload ? withStrandedFilled(payload, rawOptionValues) : rawOptionValues
  const optionValues = payload && Object.keys(rawOptionValues).length > 0 ? withAutoSelected(payload, effective) : effective
  const addonValues = entry?.addonValues ?? {}

  const variant = payload ? resolveVariant(payload, optionValues) : null
  const addonPricing = payload ? computeAddonPricing(payload.addons, addonValues) : { priceAdjust: 0, valid: true, fields: [] }
  const hasOptions = (payload?.options.length ?? 0) > 0
  // Whether there's anything to reset - the link has no business appearing over
  // a set of controls the shopper hasn't touched.
  const anyOptionChosen = payload ? payload.options.some((o) => !!optionValues[o.id]) : false
  // The cheapest a shopper could pay across the variations on offer, for the
  // "From £…" shown before a combination is settled. Enabled variants only - a
  // switched-off one is not on sale - and falls back to the parent's own price
  // if somehow none carry one, so this is never blank.
  const enabledVariantPrices = payload ? payload.variants.filter((v) => v.enabled).map((v) => v.price) : []
  const fromPrice = enabledVariantPrices.length > 0 ? Math.min(...enabledVariantPrices) : (payload?.basePrice ?? 0)
  // Whether the choices actually differ in price. Where they don't, there is no
  // range to count up from: the product has one price, whichever combination the
  // shopper settles on. Half a penny of tolerance so floating-point crumbs
  // cannot invent a range out of identical figures.
  const priceVaries = enabledVariantPrices.length > 0 && Math.max(...enabledVariantPrices) - fromPrice > 0.005
  // Before a combination is settled the price is the parent's own - except where
  // every variation costs the same, in which case that one figure IS the price
  // and stands in for the parent's (which is not shown anywhere and, with
  // variations in play, is not maintained either).
  const basePrice = variant ? variant.price
    : hasOptions && !priceVaries && enabledVariantPrices.length > 0 ? fromPrice
    : payload?.basePrice ?? 0
  const price = basePrice + addonPricing.priceAdjust
  // The chosen variant's own "was" figure. Personalisation surcharges are added
  // to both sides so the saving stays honest: strike the price this same
  // configuration would have cost off offer, not the bare variant price.
  const compareAtPrice = variant?.compareAtPrice != null ? variant.compareAtPrice + addonPricing.priceAdjust : null
  // Every picture the chosen variant owns, and the one the main stage shows.
  // An empty list means the variant brought none of its own, so the parent's
  // gallery stands as it is.
  const variantImages = variant?.imageUrls ?? []
  const image = variantImages[0] ?? payload?.baseImages[0]?.url ?? null
  // The variations the owner has promoted onto the parent's gallery, while they
  // are still worth showing: in matrix order, switched-on ones only. Images and
  // models are promoted independently of one another - a variation worth
  // showing off for its photo is not always the one worth leading with in 3D -
  // so this is two separate filters over the same list, not one.
  //
  // Both are gated on the shopper having picked nothing at all rather than on a
  // whole combination having resolved, and that is the point of the feature.
  // Before any pick, a promoted variation is showing the shopper what the range
  // looks like. The instant they choose ANYTHING they have said what they want,
  // and a rival finish sat in the strip is then answering a question nobody
  // asked - "why am I looking at the oak one, I picked walnut". A part-made
  // choice counts: waiting for the last option would leave the promoted lot up
  // through the whole of a five-option configure.
  //
  // It is also the only gate that holds still. A resolved variation blinks in and
  // out as the shopper works down the options, and hanging the strip's contents
  // off that would have thumbnails appearing and vanishing under the cursor.
  // Reset options empties the picks, so the promoted media comes back - which is
  // what a reset should look like.
  //
  // One picture each - their first - not their whole set. A promoted variation is
  // a taster of what the range offers, and four angles of the oak desk would
  // bury the product's own photographs on its own page.
  const featuredImages = payload && !anyOptionChosen
    ? payload.variants.filter((v) => v.enabled && v.showImageInGallery).map((v) => v.imageUrls[0]).filter((url): url is string => !!url)
    : []
  // By child product id, for whatever else hangs media off a product (the 3D
  // module's models, today) - a variation with no photograph of its own can
  // still be promoted for its model alone.
  const featuredModelChildIds = payload && !anyOptionChosen
    ? payload.variants.filter((v) => v.enabled && v.showModelInGallery).map((v) => v.childProductId)
    : []
  const allOptionsChosen = payload ? payload.options.every((o) => !!optionValues[o.id]) : true
  // The options still waiting on the shopper, by name and in display order, so the
  // buy button can say which ones rather than "choose your options" - and so a
  // shopper looking at eight pickers is told which two they missed.
  const missingOptionNames = payload
    ? payload.options.filter((o) => !optionValues[o.id]).map((o) => o.name)
    : []
  // What the shopper has settled on, in display order, ready to be read back to
  // them above the buy button. Only the options that are actually showing count:
  // one held back by the progressive reveal has nothing to report yet.
  const chosenSummary = payload
    ? payload.options.flatMap((o, index) => {
        if (!isOptionVisible(payload, optionValues, index)) return []
        const valueId = optionValues[o.id]
        if (!valueId) return []
        const label = o.values.find((v) => v.id === valueId)?.label
        return label ? [{ optionId: o.id, optionName: o.name, valueLabel: label }] : []
      })
    : []

  // In-stock: with options, the resolved variant must be buyable; with none, the
  // parent product's own availability governs (shop already gates that on the page).
  const inStock = hasOptions ? !!(variant && variant.enabled && variant.inStock) : true
  // allOptionsChosen is spelled out rather than left to fall out of `inStock`
  // (which needs a resolved variant, and so a full combination, to be true). The
  // two happened to agree, and relying on that made "the button is locked until
  // every option is picked" an accident of the stock check rather than a rule.
  const canAdd = !!payload && (!hasOptions || (allOptionsChosen && inStock)) && addonPricing.valid

  // Tell the rest of the page which variation is in hand. Other modules' blocks
  // (the delivery module's service picker, say) have no way into this store and
  // must not import from it, so the answer goes out as a browser event - see
  // lib/selection-broadcast.ts. Published from the hook rather than the store so
  // it reflects the same resolved variant every part on the page is showing;
  // repeat publishes from the other islands are dropped there.
  // The picks so far, in option order, as one string - a stable dependency for
  // the publish below, which would otherwise re-run on every render (the
  // selection is a fresh object each time) and lean on the broadcast's own
  // de-duplication to stay quiet.
  const chosenValueIdsKey = (payload?.options ?? []).map((o) => optionValues[o.id] ?? '').join('|')
  useEffect(() => {
    publishVariantSelection({
      slug: slug ?? '',
      parentProductId: payload?.productId ?? null,
      productId: variant?.childProductId ?? null,
      allOptionsChosen,
      chosenValueIds: chosenValueIdsKey.split('|').filter(Boolean),
    })
  }, [slug, payload?.productId, variant?.childProductId, allOptionsChosen, chosenValueIdsKey])

  function add(quantity: number): boolean {
    if (!payload || !canAdd) return false
    const targetProductId = variant ? variant.childProductId : payload.productId
    const filled: Record<string, AddonValue> = {}
    for (const a of payload.addons) {
      const v = addonValues[a.id]
      if (v != null && v !== '' && v !== false) filled[a.id] = v
    }

    // Purchase companions: a registered page component (an accessories box, say)
    // may ride along on this add - stamping meta onto the main line and adding
    // lines of its own alongside. See lib/purchase-companions.ts for the
    // contract; with nothing registered this is two empty collections and the
    // add proceeds exactly as it always has.
    const companions = collectPurchaseCompanions({
      slug: slug ?? '',
      parentProductId: payload.productId,
      productId: targetProductId,
      quantity,
    })
    const mainMeta: Record<string, unknown> = { ...companions.mainMeta }
    if (Object.keys(filled).length > 0) mainMeta.addons = filled

    if (Object.keys(mainMeta).length > 0) {
      // The stable key folds the companion meta in, so the same variation added
      // with a different accessory set (or none) stays its own line, while an
      // identical re-add merges into the existing one rather than stacking.
      addToCart(targetProductId, quantity, { lineId: stableKey(targetProductId, mainMeta), meta: mainMeta })
    } else {
      addToCart(targetProductId, quantity)
    }
    for (const line of companions.lines) {
      addToCart(line.productId, line.quantity, { lineId: line.lineId, meta: line.meta })
    }
    return true
  }

  return {
    slug,
    payload,
    loaded: entry?.loaded ?? false,
    optionValues,
    addonValues,
    variant,
    price,
    fromPrice,
    priceVaries,
    compareAtPrice,
    basePrice,
    image,
    variantImages,
    // The promoted variations' first pictures, and the variations promoted for
    // their MODEL by child product id - independent lists, both empty once the
    // shopper has picked anything at all. A gallery adds the pictures to its
    // strip and hands the ids to whatever else contributes media (see shop's
    // ShopGalleryExtraThumbsProps).
    featuredImages,
    featuredModelChildIds,
    inStock,
    hasOptions,
    allOptionsChosen,
    anyOptionChosen,
    missingOptionNames,
    chosenSummary,
    addonPricing,
    canAdd,
    // Counts the shopper's presses of Reset options. Islands showing something
    // they chose watch this and put it away - see the Entry field above.
    resetEpoch: entry?.resetEpoch ?? 0,
    // A seeded entry carries the shop's symbol; the module-level one is the
    // fetch path's. Preferring the entry's is what keeps a server render from
    // printing the default symbol and then hydrating into the real one.
    currencySymbol: entry?.currencySymbol ?? currencySymbol,
    // Wording the shop appends to a price ("inc. VAT"), or '' where it has set
    // none. Every figure above is already on the side of tax it describes - the
    // payload arrives converted (see getVariantSelectorPayload), so nothing here
    // does tax arithmetic.
    priceSuffix: payload?.priceSuffix ?? '',
    setOption: (optionId: string, valueId: string) => slug && setOptionValue(slug, optionId, valueId),
    resetOptions: () => slug && resetOptionValues(slug),
    setAddon: (addonId: string, value: AddonValue) => slug && setAddonValue(slug, addonId, value),
    isAvailable: (optionId: string, valueId: string) => (payload ? isValueAvailable(payload, optionValues, optionId, valueId) : false),
    // A pick left stranded by a change above it: present in the raw map but
    // pruned from the reachable `optionValues`. Returned so the control can show
    // it struck through and disabled. Null when the option's pick still fits (or
    // there was never one).
    ghostValue: (optionId: string) => {
      const raw = rawOptionValues[optionId]
      return raw && optionValues[optionId] !== raw ? raw : null
    },
    // Tooltip text for an unreachable value: which chosen upstream value(s)
    // rule it out. Falls back to a generic line when no single pick is the culprit.
    unavailableWith: (optionId: string, valueId: string) => (payload ? unavailableWith(payload, optionValues, optionId, valueId) : ''),
    // The other half of that: where the value IS to be had ("available in 160 to
    // 180cm"), so an out-of-reach choice can be shown struck through with a line
    // underneath pointing the shopper at the sizes that carry it, rather than
    // vanishing and taking the answer with it. The preposition comes with the
    // phrase, since a value named "With Headrest" says its own and must not be
    // handed a second one. Empty string when no single pick is the culprit.
    availabilityNote: (optionId: string, valueId: string) => (payload ? availableWithPhrase(availableWith(payload, optionValues, optionId, valueId)) : ''),
    // Whether an unreachable value is unreachable because the shelf is empty
    // rather than because of something picked above it - so the control can say
    // "out of stock", which a shopper can act on, instead of the generic line.
    // Ignores the current selection by design: see isValueOutOfStock.
    isOutOfStock: (optionId: string, valueId: string) => (payload ? isValueOutOfStock(payload, optionId, valueId) : false),
    // Whether the option at this display index is shown yet, or still held back
    // waiting on the option before it (see isOptionVisible in selection-logic).
    isOptionVisible: (index: number) => (payload ? isOptionVisible(payload, optionValues, index) : true),
    // What picking this value would cost, cheapest to dearest, given the picks
    // above it - so a control can print "from £246" under a choice that moves the
    // money. Null where nothing buyable carries it.
    valuePrice: (optionId: string, valueId: string) => (payload ? valuePriceRange(payload, optionValues, optionId, valueId) : null),
    // Whether this option's values differ in price at all. False means every
    // choice starts from the same figure, and a price under each one would be
    // four copies of the same number.
    optionAffectsPrice: (optionId: string) => (payload ? optionAffectsPrice(payload, optionValues, optionId) : false),
    add,
  }
}
