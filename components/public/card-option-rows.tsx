// The rows themselves: "Finishes" and a line of swatches, "Widths" and a list of
// sizes. Pulled out of the block so its two paths - the plain server-rendered
// summary and the interactive preview island - print the SAME markup from the same
// code, which is the parity rule card parts live by (a tile that changes shape when
// a setting is turned on is a tile the owner cannot design against).
//
// No 'use client' here on purpose: this file is imported by both a server
// component and a client one, and takes whichever side its importer is on.
//
// A row is ordinary inline flow, not flex, and that is load-bearing: the label and
// the values must share one wrapping context, so the first values sit BESIDE the
// label and only the spill starts a new line. A wrapping flex row places whole
// items - it dropped the values block, at its full one-line width, under the label
// the moment it could not fit beside it, leaving line one holding nothing but
// "Colour". Swatch values are atomic inline-block chips (a dot must not split, and
// its block-level element needs a legal seat in inline flow), spaced by margins
// where the flex gap used to be. TEXT values are genuinely inline - "1 Drawer
// Fixed Pedestal" is a phrase, and treating it as an unbreakable chip made it fall
// whole onto the next line whenever it was a whisker too wide to finish beside the
// label, which is the bug this layout exists to fix wearing a different hat. The
// comma still rides inside the value's own span so a line never opens with one,
// and the interactive form is a span with role="button" rather than a <button>,
// because a button is an atomic box by specification and can never wrap.
//
// Inline styles rather than a stylesheet, matching the rest of this module - a card
// part cannot rely on shop having emitted CSS it knows nothing about, and a <style>
// tag per part would be repeated once per card in the grid. Sized in em, never rem:
// the card sets its own font-size, and a surface may shrink the whole text block by
// turning that one figure down (shop's two-up mobile grid halves it).
import type { CSSProperties, Ref } from 'react'
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
  // Structural rather than React.MouseEvent: text values activate from keyboard
  // too (they are role="button" spans, see Value), and both event kinds carry
  // the only two methods this ever calls.
  onClick: (event: { preventDefault(): void; stopPropagation(): void }) => void
}

export type ValueInteraction = (optionIndex: number, valueIndex: number) => InteractiveValue | null

// How a "fit N lines" row is told what its own measurement decided. `shown` is
// null while the browser is still counting (and on the server, and with no
// JavaScript at all) - every value is rendered then, clamped to the allowed lines
// so nothing tall flashes, with the marker present-but-invisible so its width can
// be read. Once settled, values past `shown` are display:none and the marker
// prints `moreCount`. The measuring itself lives in FitOptionRow.tsx; this file
// only draws what it is told, so both of the block's paths keep printing
// identical markup.
export type FitState = {
  rowRef: Ref<HTMLSpanElement>
  shown: number | null
  moreCount: number
}

// Line spacing doubles as the fit clamp's yardstick: swatch rows breathe a little
// wider so wrapped lines of dots do not touch, text keeps prose rhythm.
const LINE_HEIGHT_TEXT = 1.5
const LINE_HEIGHT_SWATCH = 1.75

export const cardOptionsRootStyle: CSSProperties = { display: 'grid', gap: '0.25em', margin: '0.5em 0 0', padding: '0 1em' }
const rowStyle: CSSProperties = { display: 'block', fontSize: '0.75em', color: 'var(--color-text-muted)' }
const labelStyle: CSSProperties = { fontWeight: 600, color: 'var(--color-fg)', marginRight: '0.5em' }
// The chips. Swatches hang around the text's middle, spaced by margins (the old
// flex gap); text values are plain inline content whose words wrap like prose,
// separated by an ordinary trailing space inside each one - a space is a break
// opportunity, a margin is not.
const swatchItemStyle: CSSProperties = { display: 'inline-block', verticalAlign: 'middle', marginRight: '0.333em' }
const textItemStyle: CSSProperties = { display: 'inline' }
const dotStyle: CSSProperties = { width: '1.167em', height: '1.167em', borderRadius: 999, border: '1px solid var(--color-border)', display: 'block' }
const thumbStyle: CSSProperties = { width: '1.5em', height: '1.5em', borderRadius: 4, objectFit: 'cover', border: '1px solid var(--color-border)', display: 'block' }
const moreStyle: CSSProperties = { display: 'inline-block', fontVariantNumeric: 'tabular-nums' }

// A value the shopper can point at. The reset is a button's whole appearance: it
// has to sit in a line of text and a row of swatches without announcing itself as
// a form control. `pointerEvents: auto` is the counterweight to the island root
// turning them off - see CardOptionPreview for why the block is click-through
// except for these. Two shapes on purpose: a swatch trigger is a real <button>
// (atomic, exactly like its dot), a text trigger is an inline span carrying
// role="button", because a <button> is an unbreakable box by specification and a
// multi-word value inside one could never wrap beside the label.
const triggerStyle: CSSProperties = {
  appearance: 'none', background: 'none', border: 0, padding: 0, margin: 0, font: 'inherit', color: 'inherit',
  lineHeight: 'inherit', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', pointerEvents: 'auto',
}
const textTriggerStyle: CSSProperties = { display: 'inline', cursor: 'pointer', pointerEvents: 'auto' }
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
  if (showsSwatches) {
    return (
      <button
        type="button"
        style={{ ...triggerStyle, ...(chosen ? activeSwatchStyle : null) }}
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
  // Enter and Space are what a real button would answer to; preventDefault in the
  // handler also stops Space scrolling the page, which for a button the browser
  // would have done itself.
  return (
    <span
      role="button"
      tabIndex={0}
      style={{ ...textTriggerStyle, ...(chosen ? activeTextStyle : null) }}
      aria-pressed={interaction.pinned}
      aria-label={`Show ${value.label}`}
      onMouseEnter={interaction.onMouseEnter}
      onFocus={interaction.onFocus}
      onClick={interaction.onClick}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') interaction.onClick(event) }}
    >
      {body}
    </span>
  )
}

export function OptionRow({
  option,
  optionIndex,
  interactive,
  fit,
}: {
  option: CardOptionSummary
  optionIndex: number
  interactive?: ValueInteraction
  fit?: FitState
}) {
  const showsSwatches = option.kind === 'swatch' || option.kind === 'image'
  const lineHeight = showsSwatches ? LINE_HEIGHT_SWATCH : LINE_HEIGHT_TEXT
  const measuring = fit != null && fit.shown == null
  // While a fit row measures (and for anyone without JavaScript, for whom
  // measuring is forever), the clamp is what stands in for the answer: exactly
  // the allowed lines show, the spill is clipped rather than stacked, and the
  // marker holds its space invisibly so its width is real when read.
  const clamp: CSSProperties = measuring
    ? { maxHeight: `${(option.fit ?? 1) * lineHeight}em`, overflow: 'hidden' }
    : {}
  // In fit mode the last VISIBLE value sheds its comma (the trim happens after
  // the commas were rendered); everywhere else the last value simply is the last.
  const lastComma = fit?.shown != null ? fit.shown - 1 : option.values.length - 1
  const showMarker = fit != null ? measuring || fit.moreCount > 0 : option.more > 0
  return (
    <span style={{ ...rowStyle, lineHeight, ...clamp }} ref={fit?.rowRef}>
      <span style={labelStyle}>{option.label}</span>
      <span>
        {option.values.map((v, i) => (
          <span
            key={`${option.id}-${i}`}
            style={{
              ...(showsSwatches ? swatchItemStyle : textItemStyle),
              ...(fit?.shown != null && i >= fit.shown ? { display: 'none' } : null),
            }}
            {...(fit != null ? { 'data-fit-item': '' } : {})}
          >
            <Value option={option} valueIndex={i} showsSwatches={showsSwatches} interaction={interactive?.(optionIndex, i) ?? null} />
            {/* A list reads as a list: the comma rides INSIDE the value's span so
                a line never opens with one, but outside the trigger, so hovering
                "140cm" does not underline a comma along with it. The trailing
                space is each text value's separator AND its break opportunity;
                a hidden value takes its space with it. */}
            {!showsSwatches && i < lastComma ? ',' : null}
            {!showsSwatches ? ' ' : null}
          </span>
        ))}
        {showMarker && (
          <span
            style={{ ...moreStyle, ...(measuring ? { visibility: 'hidden' } : null) }}
            {...(fit != null ? { 'data-fit-more': '' } : {})}
          >
            +{fit != null ? fit.moreCount : option.more}
          </span>
        )}
      </span>
    </span>
  )
}
