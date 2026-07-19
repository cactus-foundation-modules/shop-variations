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
import { resolveVariant, isValueAvailable, isOptionVisible, withAutoSelected, effectiveSelection, unavailableWith, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'
import { addToCart } from '@/modules/shop/components/public/cart'
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
  return { slug, payload: null, loaded: false, fetching: false, optionValues: {}, addonValues: {}, currencySymbol: null, subs: new Set() }
}

// An entry that already holds everything the server resolved: no fetch to do and
// no empty first render. The options open unchosen (see selection-logic), so the
// controls arrive in the HTML with nothing picked in them.
function seededEntry(slug: string, bootstrap: VariationBootstrap): Entry {
  const entry = newEntry(slug)
  entry.payload = bootstrap.payload
  entry.currencySymbol = bootstrap.currencySymbol
  entry.loaded = true
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
  notify(entry)
}

export function setAddonValue(slug: string, addonId: string, value: AddonValue): void {
  const entry = getEntry(slug)
  entry.addonValues = { ...entry.addonValues, [addonId]: value }
  notify(entry)
}

// Stable line id so re-adding an identical personalised selection merges, while
// different inputs (or unique upload tokens) stay separate lines.
function stableKey(childId: string, values: Record<string, AddonValue>): string {
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
  // Prune the raw picks to the ones still reachable, then settle any option a
  // pick has narrowed to a single choice (cascading downward). The auto-settle
  // is gated on the shopper having actually picked something: an untouched page
  // opens unchosen, showing the parent's price, and must not quietly pick a
  // first option just because it happens to have one value.
  const effective = payload ? effectiveSelection(payload, rawOptionValues) : rawOptionValues
  const optionValues = payload && Object.keys(rawOptionValues).length > 0 ? withAutoSelected(payload, effective) : effective
  const addonValues = entry?.addonValues ?? {}

  const variant = payload ? resolveVariant(payload, optionValues) : null
  const addonPricing = payload ? computeAddonPricing(payload.addons, addonValues) : { priceAdjust: 0, valid: true, fields: [] }
  const hasOptions = (payload?.options.length ?? 0) > 0
  // Whether there's anything to reset - the link has no business appearing over
  // a set of controls the shopper hasn't touched.
  const anyOptionChosen = payload ? payload.options.some((o) => !!optionValues[o.id]) : false
  const basePrice = variant ? variant.price : payload?.basePrice ?? 0
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
  const allOptionsChosen = payload ? payload.options.every((o) => !!optionValues[o.id]) : true

  // In-stock: with options, the resolved variant must be buyable; with none, the
  // parent product's own availability governs (shop already gates that on the page).
  const inStock = hasOptions ? !!(variant && variant.enabled && variant.inStock) : true
  const canAdd = !!payload && (!hasOptions || inStock) && addonPricing.valid

  function add(quantity: number): boolean {
    if (!payload || !canAdd) return false
    const targetProductId = variant ? variant.childProductId : payload.productId
    const filled: Record<string, AddonValue> = {}
    for (const a of payload.addons) {
      const v = addonValues[a.id]
      if (v != null && v !== '' && v !== false) filled[a.id] = v
    }
    if (Object.keys(filled).length > 0) {
      addToCart(targetProductId, quantity, { lineId: stableKey(targetProductId, filled), meta: { addons: filled } })
    } else {
      addToCart(targetProductId, quantity)
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
    compareAtPrice,
    basePrice,
    image,
    variantImages,
    inStock,
    hasOptions,
    allOptionsChosen,
    anyOptionChosen,
    addonPricing,
    canAdd,
    // A seeded entry carries the shop's symbol; the module-level one is the
    // fetch path's. Preferring the entry's is what keeps a server render from
    // printing the default symbol and then hydrating into the real one.
    currencySymbol: entry?.currencySymbol ?? currencySymbol,
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
    // Whether the option at this display index is shown yet, or still held back
    // waiting on the option before it (see isOptionVisible in selection-logic).
    isOptionVisible: (index: number) => (payload ? isOptionVisible(payload, optionValues, index) : true),
    add,
  }
}
