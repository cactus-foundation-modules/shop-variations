// "Card: Variation options" - a part-block for shop's Product Card layout that
// summarises a product's options on its tile in a grid: the colours it comes in
// as a row of swatches, the sizes as a comma-separated list, each behind the
// label the owner chose.
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
// Inline styles rather than a stylesheet, matching the rest of this module - a
// card part cannot rely on shop having emitted CSS it knows nothing about, and a
// <style> tag per part would be repeated once per card in the grid.
import type { CSSProperties } from 'react'
import type { CardPartContext } from '@/modules/shop/components/puck/parts/part-context'
import { CARD_OPTIONS_FACT_ID, type CardOptionSummary, type CardOptionsFacts } from '@/modules/shop-variations/lib/card-options'

// Puck attaches the drag handle to a part's own root element. Shop's card parts
// explain why at length (components/puck/parts/card-parts.tsx): a wrapper div
// between `.shop-card` and the part breaks the card's child-based layout rules,
// so the ref goes on the root here too and the block is declared `inline`.
type PuckPart = { puck?: { dragRef?: ((element: Element | null) => void) | null } }

type Props = PuckPart & { _ctx?: CardPartContext }

function dragRefOf(props: PuckPart) {
  return props.puck?.dragRef ?? undefined
}

// What the editor canvas shows, where there is no product to read. Two rows so
// the owner can see both shapes - swatches and a list - while placing the block.
const SAMPLE: CardOptionSummary[] = [
  {
    id: 'sample-colour',
    label: 'Colour',
    kind: 'swatch',
    values: [
      { label: 'Charcoal', swatch: '#36393f' },
      { label: 'Navy', swatch: '#24365c' },
      { label: 'Burgundy', swatch: '#6d2635' },
    ],
    more: 4,
  },
  { id: 'sample-size', label: 'Size', kind: 'text', values: [{ label: 'Small', swatch: null }, { label: 'Medium', swatch: null }, { label: 'Large', swatch: null }], more: 0 },
]

// Sized in em, never rem: the card sets its own font-size, and a surface may
// shrink the whole text block by turning that one figure down (shop's two-up
// mobile grid halves it). rem is root-relative, so these rows would have stayed
// full size while the name and price beside them shrank. The figures are the same
// as before at the card's normal 16px base.
const rootStyle: CSSProperties = { display: 'grid', gap: '0.25em', margin: '0.5em 0 0', padding: '0 1em' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap', fontSize: '0.75em', lineHeight: 1.4, color: 'var(--color-text-muted)' }
const labelStyle: CSSProperties = { fontWeight: 600, color: 'var(--color-fg)' }
const swatchRowStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.333em', flexWrap: 'wrap' }
const dotStyle: CSSProperties = { width: '1.167em', height: '1.167em', borderRadius: 999, border: '1px solid var(--color-border)', display: 'block' }
const thumbStyle: CSSProperties = { width: '1.5em', height: '1.5em', borderRadius: 4, objectFit: 'cover', border: '1px solid var(--color-border)', display: 'block' }
const moreStyle: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

// A swatch or image value with nothing to show falls back to its label, the same
// bargain the product page's control strikes - a colour nobody picked a hex for
// is still a colour worth naming.
function SwatchValue({ value, kind }: { value: CardOptionSummary['values'][number]; kind: CardOptionSummary['kind'] }) {
  if (!value.swatch) return <span>{value.label}</span>
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- a swatch is a fixed 18px chip, and next/image would add a loader round-trip per colour per card
    return <img src={value.swatch} alt={value.label} title={value.label} style={thumbStyle} />
  }
  return <span role="img" aria-label={value.label} title={value.label} style={{ ...dotStyle, background: value.swatch }} />
}

function OptionRow({ option }: { option: CardOptionSummary }) {
  const showsSwatches = option.kind === 'swatch' || option.kind === 'image'
  return (
    <span style={rowStyle}>
      <span style={labelStyle}>{option.label}</span>
      {showsSwatches ? (
        <span style={swatchRowStyle}>
          {option.values.map((v, i) => (
            <SwatchValue key={`${option.id}-${i}`} value={v} kind={option.kind} />
          ))}
          {option.more > 0 && <span style={moreStyle}>+{option.more}</span>}
        </span>
      ) : (
        <span>
          {option.values.map((v) => v.label).join(', ')}
          {option.more > 0 && <span style={moreStyle}> +{option.more}</span>}
        </span>
      )}
    </span>
  )
}

export function ShopCardVariationOptions(props: Props) {
  const ctx = props._ctx
  // Live: this module's own entry in whatever companion modules contributed for
  // this product. A product with no option ticked for cards has none, and the
  // block renders nothing at all rather than an empty gap in the tile.
  const fact = ctx?.facts?.find((f) => f.id === CARD_OPTIONS_FACT_ID)?.payload as CardOptionsFacts | undefined
  const options = ctx ? (fact?.options ?? []) : SAMPLE
  if (options.length === 0) return null
  return (
    <div style={rootStyle} ref={dragRefOf(props)}>
      {options.map((option) => (
        <OptionRow key={option.id} option={option} />
      ))}
    </div>
  )
}

export const shopCardVariationOptionsPuckComponent = {
  label: 'Card: Variation options',
  inline: true,
  fields: {},
  defaultProps: {},
  render: ShopCardVariationOptions,
}

export const shopCardVariationOptionsPuckRscComponent = { ...shopCardVariationOptionsPuckComponent, render: ShopCardVariationOptions }
