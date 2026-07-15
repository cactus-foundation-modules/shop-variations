'use client'

// Client selection store + hook shared by the composite block and every
// granular part. Keyed by product slug so parts dropped independently into a
// layout still sync (there's no guaranteed common React ancestor to hold a
// context). One payload fetch per slug; a tiny pub/sub keeps islands in step -
// the same approach the cart uses for cross-island updates.
import { useEffect, useState } from 'react'
import { computeAddonPricing, type AddonValue } from '@/modules/shop-variations/lib/addon-pricing'
import { resolveVariant, firstPreselect, isValueAvailable, type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'
import { addToCart } from '@/modules/shop/components/public/cart'
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'

type Entry = {
  slug: string
  payload: VariantSelectorPayload | null
  loaded: boolean
  fetching: boolean
  optionValues: OptionSelection
  addonValues: Record<string, AddonValue>
  subs: Set<() => void>
}

const store = new Map<string, Entry>()
let currencySymbol = '£'
let currencyFetched = false

function getEntry(slug: string): Entry {
  let entry = store.get(slug)
  if (!entry) {
    entry = { slug, payload: null, loaded: false, fetching: false, optionValues: {}, addonValues: {}, subs: new Set() }
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
    if (entry.payload) entry.optionValues = firstPreselect(entry.payload)
  } catch {
    entry.payload = null
  } finally {
    entry.fetching = false
    entry.loaded = true
    notify(entry)
  }
}

export function setOptionValue(slug: string, optionId: string, valueId: string): void {
  const entry = getEntry(slug)
  entry.optionValues = { ...entry.optionValues, [optionId]: valueId }
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

export function useVariationSelection(slug: string | null) {
  const [, force] = useState(0)

  useEffect(() => {
    if (!slug) return
    const entry = getEntry(slug)
    const cb = () => force((n) => n + 1)
    entry.subs.add(cb)
    ensureLoaded(entry)
    return () => { entry.subs.delete(cb) }
  }, [slug])

  const entry = slug ? store.get(slug) : undefined
  const payload = entry?.payload ?? null
  const optionValues = entry?.optionValues ?? {}
  const addonValues = entry?.addonValues ?? {}

  const variant = payload ? resolveVariant(payload, optionValues) : null
  const addonPricing = payload ? computeAddonPricing(payload.addons, addonValues) : { priceAdjust: 0, valid: true, fields: [] }
  const hasOptions = (payload?.options.length ?? 0) > 0
  const basePrice = variant ? variant.price : payload?.basePrice ?? 0
  const price = basePrice + addonPricing.priceAdjust
  const image = variant?.imageUrl ?? payload?.baseImages[0]?.url ?? null
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
    basePrice,
    image,
    inStock,
    hasOptions,
    allOptionsChosen,
    addonPricing,
    canAdd,
    currencySymbol,
    setOption: (optionId: string, valueId: string) => slug && setOptionValue(slug, optionId, valueId),
    setAddon: (addonId: string, value: AddonValue) => slug && setAddonValue(slug, addonId, value),
    isAvailable: (optionId: string, valueId: string) => (payload ? isValueAvailable(payload, optionValues, optionId, valueId) : false),
    add,
  }
}
