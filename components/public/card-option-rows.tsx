// The rows themselves: "Finishes" and a line of swatches, "Widths" and a list of
// sizes. Pulled out of the block so its two paths - the plain server-rendered
// summary and the interactive preview island - print the SAME markup from the same
// code, which is the parity rule card parts live by (a tile that changes shape when
// a setting is turned on is a tile the owner cannot design against).
//
// No 'use client' here on purpose: this file is imported by both a server
// component and a client one, and takes whichever side its importer is on.
//
// Inline styles rather than a stylesheet, matching the rest of this module - a card
// part cannot rely on shop having emitted CSS it knows nothing about, and a <style>
// tag per part would be repeated once per card in the grid. Sized in em, never rem:
// the card sets its own font-size, and a surface may shrink the whole text block by
// turning that one figure down (shop's two-up mobile grid halves it).
import type { CSSProperties } from 'react'
import type { CardOptionSummary } from '@/modules/shop-variations/lib/card-options'

// What the preview island knows about one value, and how it wants to be told the
// shopper is pointing at it. Null (or absent) for every value on a card with the
// preview turned off, and for a value no variation answers to - which then renders
// as the plain label it always was, promising nothing it cannot do.
export type InteractiveValue = {
  // Fixed by a tap. Announced to assistive technology as a pressed button, but
  // deliberately NOT what the mark is drawn from - see `active`.
  pinned: boolean
  // What the picture is showing for this row at the moment, and the only thing
  // the mark follows. A pinned value is `active` too until the shopper points at
  // a different one in the same row, and then it is not: exactly one value per
  // row is ever marked, because the card is only ever showing one photo. Marking
  // the pin as well left two values in a row both looking chosen while the
  // picture could only agree with one of them. The pin comes back the moment the
  // pointer leaves the card, which is where `picks` reverts to it.
  active: boolean
  onMouseEnter: () => void
  onFocus: () => void
  onClick: (event: React.MouseEvent) => void
}

export type ValueInteraction = (optionIndex: number, valueIndex: number) => InteractiveValue | null

export const cardOptionsRootStyle: CSSProperties = { display: 'grid', gap: '0.25em', margin: '0.5em 0 0', padding: '0 1em' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap', fontSize: '0.75em', lineHeight: 1.4, color: 'var(--color-text-muted)' }
const labelStyle: CSSProperties = { fontWeight: 600, color: 'var(--color-fg)' }
const swatchRowStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '0.333em', flexWrap: 'wrap' }
const dotStyle: CSSProperties = { width: '1.167em', height: '1.167em', borderRadius: 999, border: '1px solid var(--color-border)', display: 'block' }
const thumbStyle: CSSProperties = { width: '1.5em', height: '1.5em', borderRadius: 4, objectFit: 'cover', border: '1px solid var(--color-border)', display: 'block' }
const moreStyle: CSSProperties = { fontVariantNumeric: 'tabular-nums' }

// A value the shopper can point at. The reset is a button's whole appearance: it
// has to sit in a line of text and a row of swatches without announcing itself as
// a form control. `pointerEvents: auto` is the counterweight to the island root
// turning them off - see CardOptionPreview for why the block is click-through
// except for these.
const triggerStyle: CSSProperties = {
  appearance: 'none', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: 'inherit',
  lineHeight: 'inherit', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', pointerEvents: 'auto',
}
// Chosen: a ring round a swatch, the shop's own colour on a word. Drawn for the
// value the picture is currently showing, so what the shopper is looking at and
// what they are pointing at never disagree.
const activeSwatchStyle: CSSProperties = { borderRadius: 999, boxShadow: '0 0 0 2px var(--color-primary)' }
const activeTextStyle: CSSProperties = { color: 'var(--color-primary)', fontWeight: 600 }

// A swatch or image value with nothing to show falls back to its label, the same
// bargain the product page's control strikes - a colour nobody picked a hex for is
// still a colour worth naming.
function SwatchValue({ value, kind }: { value: CardOptionSummary['values'][number]; kind: CardOptionSummary['kind'] }) {
  if (!value.swatch) return <span>{value.label}</span>
  if (kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element -- a swatch is a fixed 18px chip, and next/image would add a loader round-trip per colour per card
    return <img src={value.swatch} alt={value.label} title={value.label} style={thumbStyle} />
  }
  return <span role="img" aria-label={value.label} title={value.label} style={{ ...dotStyle, background: value.swatch }} />
}

// One value, wrapped in a button when it can be pointed at and left as bare markup
// when it cannot.
function Value({
  option,
  valueIndex,
  interaction,
  showsSwatches,
}: {
  option: CardOptionSummary
  valueIndex: number
  interaction: InteractiveValue | null
  showsSwatches: boolean
}) {
  const value = option.values[valueIndex]!
  const body = showsSwatches ? <SwatchValue value={value} kind={option.kind} /> : <span>{value.label}</span>
  if (!interaction) return body
  const chosen = interaction.active
  return (
    <button
      type="button"
      style={{ ...triggerStyle, ...(chosen ? (showsSwatches ? activeSwatchStyle : activeTextStyle) : null) }}
      aria-pressed={interaction.pinned}
      aria-label={`Show ${value.label}`}
      onMouseEnter={interaction.onMouseEnter}
      onFocus={interaction.onFocus}
      onClick={interaction.onClick}
    >
      {body}
    </button>
  )
}

export function OptionRow({
  option,
  optionIndex,
  interactive,
}: {
  option: CardOptionSummary
  optionIndex: number
  interactive?: ValueInteraction
}) {
  const showsSwatches = option.kind === 'swatch' || option.kind === 'image'
  return (
    <span style={rowStyle}>
      <span style={labelStyle}>{option.label}</span>
      <span style={showsSwatches ? swatchRowStyle : undefined}>
        {option.values.map((v, i) => (
          <span key={`${option.id}-${i}`}>
            {/* A list reads as a list: the commas are between the words, never inside
                the thing being pointed at, so hovering "140cm" does not underline a
                comma along with it. */}
            {!showsSwatches && i > 0 ? ', ' : null}
            <Value option={option} valueIndex={i} showsSwatches={showsSwatches} interaction={interactive?.(optionIndex, i) ?? null} />
          </span>
        ))}
        {option.more > 0 && <span style={moreStyle}>{showsSwatches ? `+${option.more}` : ` +${option.more}`}</span>}
      </span>
    </span>
  )
}
