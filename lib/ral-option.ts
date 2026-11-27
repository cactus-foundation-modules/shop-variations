// How a RAL-type option is read. Pure and server-safe: the storefront picker,
// the add-to-basket check and the cart-line resolver all ask the same questions
// through here, so they cannot disagree about which value is the custom one or
// whether a typed code counts.
//
// A RAL option is ordinary values underneath. Each suggested colour is a value
// whose label names its code ("RAL 7016 Anthracite grey"), and is bought like
// any other choice. One value labelled "Custom RAL" is the way in to the rest of
// the chart: its variations carry the price and stock for "any other colour",
// and the code the shopper settles on rides on the basket line as meta (meta.ral,
// keyed by option id) rather than being a value of its own - two hundred
// variations per product for colours nobody may ever order would help no one.
import { findRal, ralCodeInLabel, type RalColour } from '@/modules/shop-variations/lib/ral-classic'
import { isWithoutLabel } from '@/modules/shop-variations/lib/without-label'

// What the admin names the custom choice when it adds one, and the test that
// spots it again: any label starting "Custom", so an owner who renames it
// "Custom colour" keeps a working custom choice.
export const CUSTOM_RAL_LABEL = 'Custom RAL'
// What the admin names the "without" value of an optional RAL option. Spotted
// again by isWithoutLabel, so "None" or "No paint" work just as well.
export const NO_RAL_LABEL = 'No RAL colour'
const CUSTOM = /^\s*custom\b/i

export function isCustomRalLabel(label: string): boolean {
  return CUSTOM.test(label)
}

export type RalOptionParts<V> = {
  // The owner's suggested colours in their own order, each with its chart entry
  // (null for a value whose label names no RAL code - drawn with its own swatch
  // if it has one, or as a plain chip).
  suggestions: { value: V; colour: RalColour | null }[]
  // The custom choice, if the owner offers one. Always drawn last, wherever it
  // sits in the list.
  custom: V | null
  // The "without" value of an optional RAL option ("No RAL colour"), or null
  // when a colour must be chosen. Present, the storefront draws a tick box first
  // and only shows the colours once it is ticked; unticked picks this value.
  off: V | null
}

export function ralOptionParts<V extends { id: string; label: string }>(
  option: { controlType: string; values: V[] },
): RalOptionParts<V> | null {
  if (option.controlType !== 'RAL') return null
  let custom: V | null = null
  let off: V | null = null
  const suggestions: RalOptionParts<V>['suggestions'] = []
  for (const value of option.values) {
    if (!custom && isCustomRalLabel(value.label)) { custom = value; continue }
    if (!off && isWithoutLabel(value.label)) { off = value; continue }
    const code = ralCodeInLabel(value.label)
    suggestions.push({ value, colour: code ? findRal(code) : null })
  }
  return { suggestions, custom, off }
}

// What the custom choice will accept: any chart colour that is not already a
// suggestion. A suggested colour is sold at its own price as its own value, so
// letting it in through the custom door would charge the custom price for it.
export type CustomRalCheck =
  | { ok: true; colour: RalColour }
  | { ok: false; reason: 'empty' | 'unknown' | 'suggested'; colour?: RalColour }

export function checkCustomRal(parts: RalOptionParts<{ id: string; label: string }>, input: string | null | undefined): CustomRalCheck {
  if (!input || !input.trim()) return { ok: false, reason: 'empty' }
  const colour = findRal(input)
  if (!colour) return { ok: false, reason: 'unknown' }
  if (parts.suggestions.some((s) => s.colour?.code === colour.code)) return { ok: false, reason: 'suggested', colour }
  return { ok: true, colour }
}

// The custom codes a basket line claims, keyed by option id, with anything that
// is not a plain string dropped. Validation against the chart is the caller's -
// this only refuses to trust the shape of what the browser posted.
export function customRalMeta(meta: Record<string, unknown> | undefined): Record<string, string> {
  const raw = meta && typeof meta.ral === 'object' && meta.ral ? (meta.ral as Record<string, unknown>) : {}
  const out: Record<string, string> = {}
  for (const [optionId, code] of Object.entries(raw)) {
    if (typeof code === 'string' && code.length <= 12) out[optionId] = code
  }
  return out
}
