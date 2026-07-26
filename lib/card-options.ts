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

export type CardOptionsFacts = { options: CardOptionSummary[] }

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
export function summariseOptionForCard(option: SvrOptionWithValues): CardOptionSummary | null {
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
    values: shown.map((v) => ({ label: v.label, swatch: v.swatch })),
    more: option.values.length - shown.length,
  }
}
