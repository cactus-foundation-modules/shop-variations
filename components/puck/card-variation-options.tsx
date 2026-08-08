// "Card: Variation options" - a part-block for shop's Product Card layout that
// summarises a product's options on its tile in a grid: the colours it comes in
// as a row of swatches, the sizes as a comma-separated list, each behind the
// label the owner chose.
//
// With "Preview the photo" turned on, those values also become things a shopper
// can point at: hovering or tapping 120cm shows the 120cm desk, then walnut shows
// the 120cm walnut one, and the card's 3D icon follows to the same variation. That
// half is a client island (components/public/CardOptionPreview.tsx) and only ships
// where the owner asked for it; off, this block stays the plain server-rendered
// summary it has always been, with no JavaScript at all.
//
// The data is not fetched here. Shop resolves it once per grid through the
// `shop.card-media` point (lib/card-options-provider.ts) and injects it into every
// card part's `_ctx`, so a grid of forty products costs the same two queries as
// one. That is also why this file has no 'use client' and no prisma import: it is
// a pure view, rendered on the server on the storefront and in the editor canvas
// as a skeleton, from one file like shop's own card parts. The types and the id
// come from lib/card-options.ts rather than from the provider for the same reason
// - this file is registered as an editor component too, so anything it imports at
// runtime ends up in the client bundle, and the provider reaches for prisma.
//
// The rows themselves live in components/public/card-option-rows.tsx, shared with
// the island, so both paths print identical markup.
import type { CardPartContext } from '@/modules/shop/components/puck/parts/part-context'
import { CARD_OPTIONS_FACT_ID, type CardOptionSummary, type CardOptionsFacts } from '@/modules/shop-variations/lib/card-options'
import { OptionRow, cardOptionsRootStyle } from '@/modules/shop-variations/components/public/card-option-rows'
import { FitOptionRow } from '@/modules/shop-variations/components/public/FitOptionRow'
import { CardOptionPreview } from '@/modules/shop-variations/components/public/CardOptionPreview'

// Puck attaches the drag handle to a part's own root element. Shop's card parts
// explain why at length (components/puck/parts/card-parts.tsx): a wrapper div
// between `.shop-card` and the part breaks the card's child-based layout rules,
// so the ref goes on the root here too and the block is declared `inline`.
type PuckPart = { puck?: { dragRef?: ((element: Element | null) => void) | null } }

type Props = PuckPart & { _ctx?: CardPartContext; preview?: string }

function dragRefOf(props: PuckPart) {
  return props.puck?.dragRef ?? undefined
}

// What the editor canvas shows, where there is no product to read. Two rows so
// the owner can see both shapes - swatches and a list - while placing the block.
// The sample values carry seats too, so the preview setting looks the same in the
// canvas as it will on the page; there is no card there for it to drive.
const SAMPLE: CardOptionSummary[] = [
  {
    id: 'sample-colour',
    label: 'Colour',
    kind: 'swatch',
    values: [
      { label: 'Charcoal', swatch: '#36393f', vi: 0 },
      { label: 'Navy', swatch: '#24365c', vi: 1 },
      { label: 'Burgundy', swatch: '#6d2635', vi: 2 },
    ],
    more: 4,
  },
  { id: 'sample-size', label: 'Size', kind: 'text', values: [{ label: 'Small', swatch: null, vi: 3 }, { label: 'Medium', swatch: null, vi: 4 }, { label: 'Large', swatch: null, vi: 5 }], more: 0 },
]

const SAMPLE_PREVIEW = { variants: [{ s: 'sample-variant', v: [0, 3] }] }

export function ShopCardVariationOptions(props: Props) {
  const ctx = props._ctx
  // Live: this module's own entry in whatever companion modules contributed for
  // this product. A product with no option ticked for cards has none, and the
  // block renders nothing at all rather than an empty gap in the tile.
  const fact = ctx?.facts?.find((f) => f.id === CARD_OPTIONS_FACT_ID)?.payload as CardOptionsFacts | undefined
  const options = ctx ? (fact?.options ?? []) : SAMPLE
  if (options.length === 0) return null

  // Absent on every layout saved before this setting existed, which is the reason
  // the plain summary is what "no answer" means: an owner who never asked for the
  // preview gets exactly the tile they designed, and no client bundle with it.
  if (props.preview === 'yes') {
    const preview = ctx ? fact?.preview : SAMPLE_PREVIEW
    return <CardOptionPreview options={options} preview={preview} dragRef={dragRefOf(props)} />
  }

  return (
    <div style={cardOptionsRootStyle} ref={dragRefOf(props)}>
      {/* An option set to "as many as fit" measures itself in the browser, so that
          one row is a small client island; its neighbours (and every card without
          the setting) stay exactly the server-rendered markup they always were. */}
      {options.map((option, i) => (
        option.fit != null
          ? <FitOptionRow key={option.id} option={option} optionIndex={i} />
          : <OptionRow key={option.id} option={option} optionIndex={i} />
      ))}
    </div>
  )
}

export const shopCardVariationOptionsPuckComponent = {
  label: 'Card: Variation options',
  inline: true,
  fields: {
    preview: {
      type: 'radio' as const,
      label: 'Preview the photo when a shopper points at a value',
      options: [
        { value: 'no', label: 'No' },
        { value: 'yes', label: 'Yes' },
      ],
    },
  },
  defaultProps: { preview: 'no' },
  render: ShopCardVariationOptions,
}

export const shopCardVariationOptionsPuckRscComponent = { ...shopCardVariationOptionsPuckComponent, render: ShopCardVariationOptions }
