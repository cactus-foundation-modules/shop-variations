// The option-selection <-> query-string codec, shared by both sides: the
// browser writes the shopper's picks into the address bar as they choose
// (use-variation-selection.ts), and the server reads them back out of a shared
// link while the page renders (variation-bootstrap.ts) - which is also what
// lets the social preview image show the picked variation.
//
// Format: one parameter per option, named after the option (slugified), whose
// value is the picked value's slug - `?seat-colour=oxford-blue&width=1600mm`.
// Human-readable by design: these URLs get shared. Only parameters matching an
// option the product actually carries are ever read, and anything else on the
// URL is left exactly as it was, so this can never fight another feature's
// parameters. Pure functions, no 'use client': both halves import this.
import type { VariantSelectorPayload } from '@/modules/shop-variations/lib/types'
import { type OptionSelection } from '@/modules/shop-variations/lib/selection-logic'

// An option's parameter name. Mirrors how value slugs look (lowercase,
// hyphenated) so the pair reads as one convention. Accents fold to their bare
// letters rather than dropping out.
export function optionParamKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// The payload's options as [paramKey, option] pairs, first claim on a key wins
// (option names are unique per product, but two could slugify identically -
// "Colour!" and "Colour" - and a stable arbiter beats a coin flip). Shared by
// reader and writer so both sides always agree which option a key belongs to.
function optionsByParamKey(payload: VariantSelectorPayload) {
  const byKey = new Map<string, VariantSelectorPayload['options'][number]>()
  for (const option of payload.options) {
    const key = optionParamKey(option.name)
    if (key && !byKey.has(key)) byKey.set(key, option)
  }
  return byKey
}

// Read a shared link's picks back into option-value ids, in option order.
// Unknown keys, unknown value slugs and repeated keys are ignored rather than
// guessed at - a stale or mistyped parameter must never pick something the
// shopper didn't.
export function selectionValueIdsFromParams(
  payload: VariantSelectorPayload,
  searchParams: Record<string, string | string[] | undefined>,
): string[] {
  const ids: string[] = []
  for (const [key, option] of optionsByParamKey(payload)) {
    const raw = searchParams[key]
    const wanted = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined
    if (!wanted) continue
    const value = option.values.find((v) => v.slug === wanted)
    if (value) ids.push(value.id)
  }
  return ids
}

// The parameter writes that make a URL say exactly what is picked right now:
// a slug for every chosen option, null for every unchosen one (so its
// parameter is removed). The raw picks are what travels - ghosts included -
// because restoring the raw map replays the same derivation (auto-settle,
// stranded fill) the shopper is looking at.
export function optionParamEntries(
  payload: VariantSelectorPayload,
  optionValues: OptionSelection,
): Array<[key: string, valueSlug: string | null]> {
  const entries: Array<[string, string | null]> = []
  for (const [key, option] of optionsByParamKey(payload)) {
    const valueId = optionValues[option.id]
    const slug = valueId ? option.values.find((v) => v.id === valueId)?.slug ?? null : null
    entries.push([key, slug])
  }
  return entries
}
