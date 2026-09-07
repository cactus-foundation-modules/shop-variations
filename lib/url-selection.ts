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

// The query string for a set of picks, in the order the options are displayed:
// `headrest=with-headrest&upholstery-colour=rivet-forge`. Entries whose value is
// null are dropped, so a partial selection produces the parameters it does have.
// Returns '' for nothing picked, so callers can append it behind a `?` test.
//
// Shared by the two places that have to agree on the exact spelling of a
// variation's address: lib/sitemap.ts, which publishes it for indexing, and
// lib/canonical-query-provider.ts, which is what tells a search engine that the
// address is a page in its own right. Two spellings of the same combination
// would have the sitemap advertising a URL the page then disowns.
export function buildVariationQuery(entries: Array<[key: string, valueSlug: string | null]>): string {
  return entries
    .filter((e): e is [string, string] => !!e[1])
    .map(([key, slug]) => `${encodeURIComponent(key)}=${encodeURIComponent(slug)}`)
    .join('&')
}

// The minimum an option has to say for a variation's address to be spelled.
// Enough of SvrOptionWithValues that a selector payload's options pass straight
// in, and little enough that lib/sitemap.ts can build one out of its two SQL
// rows - which is the point: one function, so the three places that publish this
// address cannot spell it three ways.
export type VariationUrlOption = {
  id: string
  name: string
  values: Array<{ id: string; slug: string }>
}

// The published address for one variation, as a query string, spelled from the
// variation's OWN option values in display order.
//
// The single source of that spelling for everything that hands the address to
// a search engine: lib/sitemap.ts publishes it, lib/canonical-query-provider.ts
// declares it canonical on the page, and google-shopping-for-shop links to it
// from the feed. Three spellings of one combination would have the sitemap
// advertising a URL the page disowns and the feed landing on a third address.
//
// Null where the combination has no unambiguous address of its own, and the
// caller should fall back to whatever it used before rather than invent one:
//
//  - a product where two options slugify to the same parameter name, so two
//    combinations would share one address and reading it back is a coin flip;
//  - a variation that leaves one of the product's options unanswered, or names
//    a value that is not one of them - the address would quietly render the
//    bare listing instead of the thing it names;
//  - a variation naming two values of a single option, which resolves to
//    nothing.
export function variationCanonicalQuery(
  options: VariationUrlOption[],
  optionValueIds: string[],
): string | null {
  if (options.length === 0) return null

  // First claim would normally win (optionsByParamKey above), but a URL nobody
  // can read back is worse than no URL, so a clash disqualifies the product.
  const keyByOption = new Map<string, string>()
  const claimed = new Set<string>()
  for (const option of options) {
    const key = optionParamKey(option.name)
    if (!key || claimed.has(key)) return null
    claimed.add(key)
    keyByOption.set(option.id, key)
  }

  const optionByValue = new Map<string, { optionId: string; slug: string }>()
  for (const option of options) {
    for (const value of option.values) optionByValue.set(value.id, { optionId: option.id, slug: value.slug })
  }

  const slugByOption = new Map<string, string>()
  for (const valueId of optionValueIds) {
    const found = optionByValue.get(valueId)
    if (!found || slugByOption.has(found.optionId)) return null
    slugByOption.set(found.optionId, found.slug)
  }
  if (slugByOption.size !== options.length) return null

  return buildVariationQuery(
    options.map((o) => [keyByOption.get(o.id)!, slugByOption.get(o.id) ?? null]),
  ) || null
}
