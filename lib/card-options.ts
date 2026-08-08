// The shape of a product card's option summary, and the pure rule for building
// one from an option. Deliberately free of prisma and of anything server-only:
// the card part-block (components/puck/card-variation-options.tsx) imports the id
// and the types from here, and that block is registered as an editor component
// too, so anything it touches lands in the client bundle. The provider that
// actually reads the database lives next door in card-options-provider.ts.
import type { SvrOptionWithValues } from '@/modules/shop-variations/lib/types'

// How a card draws one option's values. Swatches and images become a row of small
// dots; everything else (dropdowns and pills) becomes a comma-separated list of
// labels, which is all a tile has room for.
export type CardOptionKind = 'swatch' | 'image' | 'text'

export type CardOptionValue = {
  label: string
  // Hex colour for a swatch, image url for an image, null when the value never
  // got one - the card falls back to the label in that case, exactly as the
  // product page's control does.
  swatch: string | null
  // This value's seat in the product's own preview dictionary (see
  // CardOptionsPreview). Numbers rather than the option_value_id itself because a
  // grid of forty cards ships this payload forty times, and a 36-character uuid
  // per value per variation is most of the weight for nothing a shopper sees.
  // Absent when the product has no preview data at all.
  vi?: number
}

export type CardOptionSummary = {
  id: string
  // What the card prints in front of the values: the owner's card label if they
  // set one, else the option's own name.
  label: string
  kind: CardOptionKind
  // Already trimmed to the option's limit, so the block does no arithmetic.
  values: CardOptionValue[]
  // How many values did not fit, for the "+4" marker. Zero when they all did.
  more: number
}

// One variation, reduced to the only two things a card preview needs of it: the
// tag its photo carries in shop's carousel (`PartImage.sourceId`, which is the
// variation's child product id), and which of the card's own option values it
// answers to. Short keys because this is the repeated part of the payload.
export type CardPreviewVariant = {
  // sourceId - the child product id.
  s: string
  // The `vi` seats of the values this variation carries, for card-shown options
  // only. Options the card does not print are dropped, because a shopper can
  // never pick one on a tile.
  v: number[]
}

// Everything the card needs to answer "which photo is THIS combination?" without
// asking the server again. Present only on products that have variations worth
// previewing; the block renders its plain summary when it is absent.
export type CardOptionsPreview = {
  // In the variation matrix's own order, deduplicated by value-set: two variations
  // that differ only in an option the card does not show are one entry here, and
  // the first of them wins - the same "first match" rule the filters module uses.
  variants: CardPreviewVariant[]
}

export type CardOptionsFacts = { options: CardOptionSummary[]; preview?: CardOptionsPreview }

// The id this module registers its card provider under. Shop hands the payload
// back tagged with it, and the card block looks itself up by the same string.
export const CARD_OPTIONS_FACT_ID = 'variations-card-options'

function kindOf(controlType: string): CardOptionKind {
  if (controlType === 'SWATCH') return 'swatch'
  if (controlType === 'IMAGE') return 'image'
  return 'text'
}

// One option's card summary, or null when it has nothing to say there: the owner
// has not asked for it, or nobody has given it any values yet - and an empty
// "Colour:" on a tile reads as a fault rather than as information.
//
// `seatOf` is how a value finds its number in the product's preview dictionary
// (see buildCardOptionsFacts). Omitted where there is no preview to build, and
// the values then carry no `vi` at all.
export function summariseOptionForCard(option: SvrOptionWithValues, seatOf?: (valueId: string) => number | undefined): CardOptionSummary | null {
  if (!option.cardDisplay) return null
  if (option.values.length === 0) return null
  // A null limit means "all of them", which is also what a limit at or above the
  // count means - both leave `more` at zero and print no marker. A stored limit
  // of zero or less would hide every value while still printing the label, so it
  // is treated as no limit rather than obeyed.
  const limit = option.cardLimit != null && option.cardLimit > 0 ? option.cardLimit : option.values.length
  const shown = option.values.slice(0, limit)
  return {
    id: option.id,
    label: option.cardLabel?.trim() || option.name,
    kind: kindOf(option.controlType),
    values: shown.map((v) => ({ label: v.label, swatch: v.swatch, vi: seatOf?.(v.id) })),
    more: option.values.length - shown.length,
  }
}

// One variation as the caller loaded it: its child product id and every option
// value it carries, card-shown or not.
export type CardPreviewVariantInput = { childProductId: string; valueIds: string[] }

// The whole payload for one product: the summaries, plus the lookup that lets a
// card answer "120cm, in walnut, on a black frame - which photo is that?" in the
// browser with no round trip.
//
// Pure, and prisma-free like the rest of this file, so it can be unit-tested and
// so the block that imports the types beside it stays out of the server bundle.
// The provider next door does the loading and hands the rows in.
//
// Only card-SHOWN options take part. A value the tile never prints cannot be
// hovered, so carrying it would only make every variation's entry longer; two
// variations that differ solely in such an option collapse to one, first wins.
export function buildCardOptionsFacts(options: SvrOptionWithValues[], variants: CardPreviewVariantInput[]): CardOptionsFacts | null {
  // Seats are handed out over every value of every card-shown option - including
  // the ones trimmed off by `cardLimit`, which are still worth a seat: a shopper
  // cannot hover them, but a variation that carries one can still be the answer
  // to a choice made on a different option.
  const seats = new Map<string, number>()
  for (const option of options) {
    if (!option.cardDisplay) continue
    for (const value of option.values) if (!seats.has(value.id)) seats.set(value.id, seats.size)
  }

  const summaries: CardOptionSummary[] = []
  for (const option of options) {
    const summary = summariseOptionForCard(option, (id) => seats.get(id))
    if (summary) summaries.push(summary)
  }
  // A product where nothing was ticked contributes nothing at all, so its card
  // carries no payload and the block renders nothing on it.
  if (summaries.length === 0) return null

  const seen = new Set<string>()
  const previewVariants: CardPreviewVariant[] = []
  for (const variant of variants) {
    const v = variant.valueIds.map((id) => seats.get(id)).filter((seat): seat is number => seat !== undefined).sort((a, b) => a - b)
    // A variation with nothing the card shows can never be the answer to a choice
    // made on one, so it is left out rather than sitting there matching nothing.
    if (v.length === 0) continue
    const key = v.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    previewVariants.push({ s: variant.childProductId, v })
  }

  return previewVariants.length > 0 ? { options: summaries, preview: { variants: previewVariants } } : { options: summaries }
}

// The variation a partial choice points at, as a photo `sourceId` - or null when
// nothing answers to it.
//
// `picks` has one slot per card option, in the order the card prints them, each
// holding the `vi` the shopper is on or null for "not chosen". A full house is
// rare on a tile and never required: the first variation carrying every chosen
// value wins, which is what makes the choices accumulate - width alone shows the
// first 120cm desk, width plus finish narrows it to the walnut one.
//
// When nothing carries the whole set, choices are given up from the BOTTOM until
// something does: the same directional rule the product page's selector uses
// (isValueAvailable in selection-logic.ts). A finish that does not come in the
// chosen width must never blank the card - it falls back to showing the width.
export function resolvePreviewSource(preview: CardOptionsPreview | undefined, picks: Array<number | null>): string | null {
  if (!preview || preview.variants.length === 0) return null
  for (let depth = picks.length; depth > 0; depth--) {
    const wanted = picks.slice(0, depth).filter((p): p is number => p !== null)
    if (wanted.length === 0) continue
    const hit = preview.variants.find((variant) => wanted.every((seat) => variant.v.includes(seat)))
    if (hit) return hit.s
  }
  return null
}
