'use client'

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { OPTIONS_AREA_CLASS } from '@/modules/shop-variations/lib/use-sticky-mobile-gallery'
import { useVariationSelection } from '@/modules/shop-variations/lib/use-variation-selection'
import { useProductSlug } from '@/modules/shop-variations/lib/use-product-slug'
import type { AddonValue, AddonFileValue } from '@/modules/shop-variations/lib/addon-pricing'
import type { ShopGalleryExtra } from '@/modules/shop/lib/gallery-media'
import type { SvrAddon, SvrOptionWithValues, VariationBootstrap } from '@/modules/shop-variations/lib/types'

// On the live page each part is handed the slug and the payload its RSC half
// already resolved, so the controls are in the server's HTML from the off.
// Failing that (a layout we can't identify the product from server-side) a part
// still resolves the slug from the URL after mount and fetches, so one dropped
// somewhere unexpected keeps working - all parts on a page land on the same slug
// and therefore share one selection store entry either way.
type PartProps = { preview?: boolean; slug?: string | null; initial?: VariationBootstrap | null }

// Where an option's name sits relative to its choices. 'above' is the long-standing
// look and stays the default everywhere; 'beside' is opt-in per block, for narrow
// columns where a stack of name-then-choices runs the page long.
export type OptionLabelPlacement = 'above' | 'beside'

// How the whole set of option pickers lays out. 'inline' is the long-standing look
// (every option's choices on show at once); 'accordion' collapses each option into
// its own expandable section, one heading per option.
export type VariantDisplayMode = 'inline' | 'accordion'

// Accordion only. Which sections are open when the page first loads.
export type AccordionInitial = 'closed' | 'first' | 'all'

// Accordion only, and only when the load state leaves a next section to open
// (closed or first - moot under "all", which already has everything open). What
// happens to the sections once a choice is made in one of them.
export type AccordionOnSelect = 'none' | 'openNext' | 'openNextCloseCurrent'

// How a colour/image choice draws itself. 'pill' is the long-standing look (a
// pill carrying the swatch AND its name); 'swatchOnly' drops the name to a hover
// tooltip and shows just the swatch or thumbnail.
export type SwatchDisplay = 'pill' | 'swatchOnly'

// Whether hovering a colour/image choice pops a bigger look at it - the full
// picture for an image value, a proper block of colour for a swatch value. Off
// leaves the small swatch or thumbnail as the only thing on show. Independent of
// SwatchDisplay: the swatch-only look still names the value on hover either way,
// it just gains the picture above the name when previews are on.
export type SwatchPreview = 'show' | 'hide'

// What becomes of a choice the picks above it have put out of reach. 'show'
// keeps it in the row, struck through and unpickable, with a line underneath
// saying where it IS to be had ("available in 160 to 180cm") - a shopper who
// wanted that choice is told which other pick would get them it, rather than
// being left wondering why it went. 'hide' drops it from the row entirely, the
// older behaviour, for an option whose values are too many for that to read as
// anything but clutter.
export type UnavailableDisplay = 'show' | 'hide'
// Where the choices this combination cannot have sit in the row. 'keep' is the
// order the shop typed them in, which is what this always did. 'last' moves them
// to the end so the shopper meets the choices they can actually make first - on
// a chair whose first headrest option is out of stock, the row otherwise opens
// with a struck-through dead end.
export type UnavailableOrder = 'keep' | 'last'

// Reusable storefront parts. Each takes the product slug and reads the shared
// selection store, so they stay in sync whether composed together (the composite
// block) or dropped independently (the granular Product Detail parts).

function Skeleton({ label }: { label: string }) {
  return (
    <div style={{ border: '1px dashed var(--color-border)', borderRadius: 8, padding: '0.75rem 1rem', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
      {label} (shown on the live product page)
    </div>
  )
}

const money = (n: number, symbol: string) => `${symbol}${n.toFixed(2)}`

// The same figure with a bare `.00` trimmed off, for the price hints that sit
// under an option's choices. Those are a glance, not an invoice - "from £246"
// reads at 12px where "from £246.00" is mostly decimal point - and a price with
// real pence still shows them.
const moneyShort = (n: number, symbol: string) => {
  const full = money(n, symbol)
  return full.endsWith('.00') ? full.slice(0, -3) : full
}

// The price hint under one of an option's choices: what the shopper would pay if
// they picked it. "from" only where that choice still leaves a range - a value
// that pins the price exactly says the one figure plainly. Null where the value is
// unreachable.
//
// Deliberately does NOT ask whether the option moves the money: that answer is the
// same for every value in the option, and asking it here would walk the whole
// option's variants once PER VALUE. Callers hoist it (`showPrices`) and gate on it.
function valuePriceHint(sel: ReturnType<typeof useVariationSelection>, optionId: string, valueId: string): string | null {
  const range = sel.valuePrice(optionId, valueId)
  if (!range) return null
  const varies = range.max - range.min > 0.005
  return `${varies ? 'from ' : ''}${moneyShort(range.min, sel.currencySymbol)}`
}

// "Choose Width and Storage first" - the options the shopper still owes us, named,
// for the locked buy button's tooltip and its written note. An Oxford-free list
// because this is a sentence a shopper reads, not a data structure.
export function missingOptionsSentence(names: string[]): string | null {
  if (names.length === 0) return null
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `Choose ${list} first`
}

// The buy button's own words, sized to the room it has. The button says why it
// is locked ("Choose Width and Modesty Panel first") rather than leaving that to
// a line underneath, so the control a shopper is reaching for is the one that
// answers them - but a reason naming three options is three times the length of
// "Add to basket", and the button is a fixed-height pill. So the label measures
// itself and takes its type size down until it fits on one line.
//
// One line is tried first. Text width scales with font size only approximately -
// subpixel rounding and hinting mean a size computed by straight arithmetic (the
// natural width read at whatever size it happens to be drawn at, rescaled to the
// button's own size) can come out a fraction too big, and the label always
// carries `overflow: hidden; text-overflow: ellipsis` - so an estimate trusted
// blind does not overflow visibly, it just loses its last word or two under the
// ellipsis, which reads as a clipped sentence rather than a shrunk one. So the
// arithmetic is a starting point, not the answer: applied, then measured for
// real, and crept down half a pixel at a time until the actual box holds the
// actual text. Every step re-measures against a nowrap line, so the answer can
// never depend on the size already applied and the fit cannot oscillate.
//
// Where one line would mean type too small to read - a phone, five outstanding
// options - the label takes a SECOND line instead of shrinking further. "Choose
// Seats, Width Per Desk, Depth, Finish and Frame Colour first" is 65 characters,
// and at 390px there is no honest single-line size for it: the first cut of this
// shrank to the floor and still clipped a word off the end, which is worse than
// the note it replaced. Two lines are searched by measurement rather than
// arithmetic, because where a wrap falls is not something a ratio can predict:
// step down from the size two lines could hold in theory until the text really
// does fit in two, no wider than the button. `SINGLE_LINE_FLOOR` is where one
// line stops being worth it; `min` is the hard floor for both.
//
// `width: 0` + `min-width: 100%` on the host is what makes any of that possible,
// and is not a flourish: a nowrap line's min-content width is the WHOLE line, so
// a plain `width: 100%` host hands the button an intrinsic minimum the length of
// the sentence. The button then grows to fit the words rather than the words
// shrinking to fit the button - it takes the buy row's whole width, wraps off the
// end of the quantity stepper, and the measurement below finds all the room it
// could ever want and never shrinks a thing. Percentages are ignored when a box's
// intrinsic contribution is computed, so `width: 0` is what the button sizes
// itself against (nothing, as it should be, since the label bends to the button)
// while `min-width: 100%` is what the host is actually drawn at.
const SINGLE_LINE_FLOOR = 13
const FIT_LINE_HEIGHT = 1.15

type FitState = { size: number | null; wrap: boolean }
const FIT_UNMEASURED: FitState = { size: null, wrap: false }

export function FitLabel({ text, min = 11 }: { text: string; min?: number }) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  // Unmeasured = the button's own size on one line, which is also the
  // server-rendered and no-JavaScript state, so hydration matches and a label
  // that fits never measures its way to something different from the HTML it
  // shipped as.
  const [fitted, setFitted] = useState<FitState>(FIT_UNMEASURED)

  // New wording starts the measurement over, adjusted during render so the fit
  // worked out for the OLD sentence never reaches the screen with the new one in
  // it.
  const [measuredFor, setMeasuredFor] = useState(text)
  if (measuredFor !== text) {
    setMeasuredFor(text)
    setFitted(FIT_UNMEASURED)
  }

  useLayoutEffect(() => {
    const host = hostRef.current
    const label = textRef.current
    if (!host || !label) return

    // Every measurement starts from the same place - base size, one line - so
    // two runs of this on the same button can never disagree.
    const apply = (state: FitState) => {
      label.style.whiteSpace = state.wrap ? 'normal' : 'nowrap'
      label.style.fontSize = state.size == null ? '' : `${state.size}px`
    }

    const fit = () => {
      const room = host.clientWidth
      if (room <= 0) return
      const base = Number.parseFloat(getComputedStyle(host).fontSize) || 16
      apply(FIT_UNMEASURED)
      const natural = label.scrollWidth
      if (natural <= room) { setFitted(FIT_UNMEASURED); return }

      const singleFloor = Math.min(base, SINGLE_LINE_FLOOR)
      // The arithmetic ratio is a fast starting point, not the answer - apply
      // it, measure for real, and creep down half a pixel at a time until the
      // actual box holds the actual text. Anything that clears singleFloor
      // wins outright; falling through it means one line was never honestly
      // readable for this sentence, not that the last attempt is good enough.
      const estimate = Math.floor((room / natural) * base * 10) / 10
      let size = estimate
      let fitsOneLine = false
      while (size >= singleFloor) {
        apply({ size, wrap: false })
        if (label.scrollWidth <= room) { fitsOneLine = true; break }
        size = Math.floor((size - 0.5) * 10) / 10
      }

      let next: FitState
      if (fitsOneLine) {
        next = { size, wrap: false }
      } else {
        // Two lines hold twice the width, less whatever the wrap wastes at the
        // end of the first - so the one-line estimate gives the ceiling to
        // start from and the measuring settles where it actually lands. Also
        // clamped up to `min` before the first attempt: an extreme case (four
        // options outstanding on a phone) can seed below the floor, and if
        // that happened to fit outright the loop would return it without ever
        // reaching the check that enforces the floor on the way down.
        size = Math.max(min, Math.min(base, Math.floor(estimate * 1.8 * 10) / 10))
        for (;;) {
          apply({ size, wrap: true })
          const fits = label.scrollWidth <= room + 1
            && label.scrollHeight <= size * FIT_LINE_HEIGHT * 2 + 1
          if (fits || size <= min) break
          size = Math.max(min, Math.floor((size - 0.5) * 10) / 10)
        }
        next = { size, wrap: true }
      }
      // Straight onto the element as well as into state: the observer below can
      // fire between paints, and leaving the base-size measurement on screen
      // until React comes round again would show the label at full size for a
      // frame.
      apply(next)
      setFitted(next)
    }

    fit()
    if (typeof ResizeObserver === 'undefined') return
    // The button changes width with the page (a phone turned on its side, the
    // buy row wrapping), and a web font arriving late changes every measurement
    // taken before it.
    const observer = new ResizeObserver(fit)
    observer.observe(host)
    let stale = false
    document.fonts?.ready.then(() => { if (!stale) fit() }).catch(() => {})
    return () => { stale = true; observer.disconnect() }
  }, [text, min])

  return (
    <span ref={hostRef} style={{ display: 'block', width: 0, minWidth: '100%', overflow: 'hidden' }}>
      <span
        ref={textRef}
        style={{
          display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: FIT_LINE_HEIGHT,
          whiteSpace: fitted.wrap ? 'normal' : 'nowrap',
          ...(fitted.size == null ? {} : { fontSize: `${fitted.size}px` }),
        }}
      >
        {text}
      </span>
    </span>
  )
}

// The numbered marker beside an option's name: an outlined circle while the option
// is still open, filled once the shopper has answered it. It is a progress count
// through the configuration, which is why it numbers the options as SHOWN - an
// option held back by the progressive reveal has no number yet, and the one after
// it does not skip ahead to fill the gap.
//
// aria-hidden: the number is a visual aid, and a screen reader reading "2 Storage"
// would be reading out a decoration. The option's name is already its label.
function OptionNumber({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, flex: 'none', marginRight: '0.5rem',
        borderRadius: 999, fontSize: '0.75rem', fontWeight: 700, lineHeight: 1,
        border: `1.5px solid ${done ? 'var(--color-primary)' : 'var(--color-border)'}`,
        background: done ? 'var(--color-primary)' : 'transparent',
        color: done ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
        verticalAlign: 'middle',
      }}
    >
      {n}
    </span>
  )
}

// The "Sale" badge that lands on an individual choice which leads to a reduced
// price, on a product where only some of the variations are on offer. It marks
// the choices themselves rather than the option above them, so a shopper reads
// "180cm - Sale" and knows exactly which one carries the offer. The figure under
// the choice, and the struck-through price by the buy button, say by how much.
//
// Subtle background with the deeper destructive text rather than a solid fill:
// the label is small and bold, and white on the theme's terracotta is short of
// AA at this size. This pairing clears it in both light and dark. No border -
// the border token is not redefined for dark and would come out light on dark.
// `spaced` is off where the badge's neighbour already spaces it - the swatch-only
// button lays its contents out with a gap, and a margin on top of that leaves the
// badge adrift from the colour it belongs to.
function SaleBadge({ spaced = true }: { spaced?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', marginLeft: spaced ? '0.375rem' : 0,
        padding: '0.0625rem 0.3125rem', borderRadius: 999,
        fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1.4,
        letterSpacing: '0.02em', textTransform: 'uppercase',
        background: 'var(--color-destructive-subtle)',
        color: 'var(--color-destructive-hover)',
      }}
    >
      Sale
    </span>
  )
}

// The tick that lands on a chosen value, overlapping its top-right corner. Filled
// with the theme's primary and ringed in the surface colour so it reads as a badge
// stuck on the choice rather than a mark inside it, on any background the theme
// puts behind the row.
function ChosenTick() {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute', top: -5, right: -5, width: 18, height: 18,
        borderRadius: 999, background: 'var(--color-primary)',
        boxShadow: '0 0 0 2px var(--color-surface)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-on-primary)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    </span>
  )
}

// What the shopper has settled on, read back to them just above the buy button so
// the thing they are about to pay for is written down in words rather than only
// implied by which pills happen to be lit. Only shows once the configuration is
// complete: a half-answered list would be a running commentary, and the pills
// already say that better than a sentence can.
export function SelectionSummary({ sel }: { sel: ReturnType<typeof useVariationSelection> }) {
  if (!sel.hasOptions || !sel.allOptionsChosen) return null
  if (sel.chosenSummary.length === 0) return null
  return (
    <div
      // role="status" so a screen reader hears the configuration settle as the
      // last option is picked, which is the moment the button unlocks.
      role="status"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        marginTop: '18px', padding: '0.625rem 0.875rem',
        borderRadius: 10, border: '1px solid var(--color-success-border)',
        background: 'var(--color-success-bg)', color: 'var(--color-success)',
        fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.35,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: 'none' }}>
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <span>
        Ready to add: {sel.chosenSummary.map((c) => c.valueLabel).join(' · ')}
      </span>
    </div>
  )
}

// The figure behind "In stock", for staff only, sat with the buy row it belongs
// to. A shopper is told whether a combination can be bought and never how many
// there are - and the numbers are not merely hidden here, they are withheld from
// the payload entirely unless the person reading it is signed in with shop access
// (see shop's lib/admin-stock.ts), so there is nothing to read out of the network
// tab either. Which is also why this needs no permission check of its own: a
// shopper's payload simply has no figures in it.
//
// Labelled "staff only" on its face, because it sits in the middle of a public
// page and an owner showing a customer their screen must not have to wonder
// whether the customer can see it too.
export function AdminStockNote({ sel }: { sel: ReturnType<typeof useVariationSelection> }) {
  if (!sel.payload?.showStockCounts) return null
  // With options in play the figure belongs to the combination in hand, and
  // there is no single number until the shopper has settled on one. With none -
  // a product we claimed for its personalisation fields alone - the parent row
  // IS the thing being bought, so its own figure stands.
  const stock = sel.hasOptions
    ? (sel.variant ? { tracked: sel.variant.tracksStock ?? sel.variant.stockCount != null, count: sel.variant.stockCount } : null)
    : sel.payload.baseStock ?? null
  if (!stock) return null
  return (
    <p
      style={{
        margin: '10px 0 0', display: 'inline-flex', alignItems: 'baseline', gap: '0.5rem',
        padding: '5px 10px', borderRadius: 8,
        border: '1px dashed var(--color-border)', background: 'var(--color-surface)',
        color: 'var(--color-text-muted)', fontSize: '0.8125rem', lineHeight: 1.35,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {/* "Not tracked" rather than a blank, so nothing here is ever read as a
          figure that failed to load: this combination simply has stock tracking
          switched off and is always buyable. */}
      <strong style={{ fontWeight: 700 }}>{stock.tracked ? `Stock: ${stock.count ?? 0}` : 'Stock: not tracked'}</strong>
      <span>staff only</span>
    </p>
  )
}

// The chosen combination's own codes, for staff, sat with the buy row alongside
// the stock figure. Same withholding as that one: the codes are absent from a
// shopper's payload entirely (shop's lib/admin-codes.ts), so this needs no
// permission check of its own and there is nothing in the network tab either.
//
// Held back until every option is settled, deliberately. A half-built
// configuration matches no single row, so there is no code to print - and a
// stale one left on screen from the last complete combination is worse than
// none, because it is the thing the owner would go and order.
export function AdminSkuNote({ sel }: { sel: ReturnType<typeof useVariationSelection> }) {
  if (!sel.payload?.showCodes) return null
  // With no options in play the parent row IS what is being bought, and shop's
  // own SKU part already writes its codes further up the page - printing them
  // again here would just say the same thing twice.
  if (!sel.hasOptions || !sel.variant) return null
  const sku = sel.variant.sku ?? null
  const saleSku = sel.variant.saleSku ?? null
  if (!sku && !saleSku) return null
  return (
    <p
      style={{
        margin: '10px 0 0', display: 'inline-flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap',
        padding: '5px 10px', borderRadius: 8,
        border: '1px dashed var(--color-border)', background: 'var(--color-surface)',
        color: 'var(--color-text-muted)', fontSize: '0.8125rem', lineHeight: 1.35,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {sku && <strong style={{ fontWeight: 700 }}>SKU: {sku}</strong>}
      {saleSku && <strong style={{ fontWeight: 700 }}>Sale SKU: {saleSku}</strong>}
      <span>staff only</span>
    </p>
  )
}

// The pill that sits over the gallery stage once the shopper has settled on a
// combination and the stage is showing THAT combination - its own photograph or
// its own 3D model - rather than the product's general pictures. It answers the
// question a configurator quietly raises: is this picture the thing I just built,
// or is it the one off the catalogue page?
export function YourChoicePill() {
  return (
    <span
      style={{
        position: 'absolute', top: 10, left: 10, zIndex: 3, pointerEvents: 'none',
        display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
        padding: '5px 10px', borderRadius: 999,
        background: 'var(--color-primary)', color: 'var(--color-on-primary)',
        fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '.02em', lineHeight: 1,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6L9 17l-5-5" />
      </svg>
      Your choice
    </span>
  )
}

// A layout effect on the client, a plain effect on the server. The accordion's
// auto-advance (below) must open the next section BEFORE the browser paints the
// shopper's choice - a plain post-paint effect leaves one painted frame with the
// next section still shut, which reads as a lag. useLayoutEffect commits it in
// the same frame; the server swap keeps React from warning it does nothing there
// (this subtree is server-rendered whenever the product was resolved server-side).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

// ---- Options -------------------------------------------------------------
export type VariantOptionsPartProps = PartProps & {
  labelPlacement?: OptionLabelPlacement
  displayMode?: VariantDisplayMode
  accordionInitial?: AccordionInitial
  accordionOnSelect?: AccordionOnSelect
  swatchDisplay?: SwatchDisplay
  swatchPreview?: SwatchPreview
  unavailable?: UnavailableDisplay
  unavailableOrder?: UnavailableOrder
}
export function VariantOptionsPart({
  preview, slug: explicitSlug, initial, labelPlacement,
  displayMode = 'inline', accordionInitial = 'closed', accordionOnSelect = 'openNext', swatchDisplay = 'pill',
  swatchPreview = 'show', unavailable = 'show', unavailableOrder = 'keep',
}: VariantOptionsPartProps) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  // The skeleton is the editor's placeholder and belongs nowhere near a shopper:
  // on the live page an unresolved slug renders nothing at all until it resolves.
  if (preview) return <Skeleton label="Variant options" />
  if (!slug || !sel.loaded) return null
  if (!sel.payload || sel.payload.options.length === 0) return null

  // An option held back by the progressive reveal (isOptionVisible) is out of both
  // layouts alike - the accordion never draws a heading for one the shopper isn't
  // meant to have reached yet.
  const visibleOptions = sel.payload.options.filter((_, index) => sel.isOptionVisible(index))
  if (visibleOptions.length === 0) return null

  return (
    // The class marks the option pickers' extent for the pinned mobile gallery
    // (lib/use-sticky-mobile-gallery.ts); it carries no styling.
    // data-spd-configure is shop's documented hook: its tab strip's Configure
    // action scrolls here rather than to the buy button, and the scroll margin
    // keeps the landing clear of the header and a sticky bar.
    <div className={OPTIONS_AREA_CLASS} data-spd-configure style={{ display: 'grid', gap: '1rem', scrollMarginTop: 'calc(var(--spd-header-h,96px) + var(--spd-tabnav-h,0px) + 16px)' }}>
      {displayMode === 'accordion' ? (
        <VariantOptionsAccordion options={visibleOptions} sel={sel} initial={accordionInitial} onSelect={accordionOnSelect} swatchDisplay={swatchDisplay} swatchPreview={swatchPreview} unavailable={unavailable} unavailableOrder={unavailableOrder} />
      ) : (
        visibleOptions.map((option, index) => (
          <OptionControl key={option.id} option={option} sel={sel} index={index + 1} labelPlacement={labelPlacement} swatchDisplay={swatchDisplay} swatchPreview={swatchPreview} unavailable={unavailable} unavailableOrder={unavailableOrder} />
        ))
      )}
    </div>
  )
}

// The accordion layout: one collapsible section per option, its heading the option
// name (and, once chosen, the picked value), its panel the same OptionControl the
// inline layout uses - drawn with its own label hidden, because the heading is the
// label here.
//
// Open/close state is the shopper's, seeded once from `initial` on mount. When a
// choice opens the next section (`onSelect`), the move is routed through
// `pending`: the option that comes next may only be revealed by the very choice
// that triggers this (the progressive reveal above), so we wait for the render
// that choice causes and read the freshly-widened `options` list, rather than the
// stale one we held when the click landed. That drain runs in a LAYOUT effect,
// not a plain one, so the next section opens in the same paint as the choice -
// a post-paint effect left a frame with it still shut, which read as a lag.
function VariantOptionsAccordion({
  options, sel, initial, onSelect, swatchDisplay, swatchPreview, unavailable, unavailableOrder = 'keep',
}: {
  options: SvrOptionWithValues[]
  sel: ReturnType<typeof useVariationSelection>
  initial: AccordionInitial
  onSelect: AccordionOnSelect
  swatchDisplay: SwatchDisplay
  swatchPreview: SwatchPreview
  unavailable: UnavailableDisplay
  unavailableOrder?: UnavailableOrder
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    // Arriving on a variation link seeds every pick before first paint (the URL
    // named a specific variant). With the whole configuration already chosen, a
    // stack of collapsed headers hides the answer the shopper came in on - so
    // open every section and show it. This wins over the block's initial
    // setting, which only governs a fresh page the shopper hasn't chosen on yet.
    const preselected = options.some((o) => !!sel.optionValues[o.id])
    if (preselected || initial === 'all') return new Set(options.map((o) => o.id))
    if (initial === 'first') return options[0] ? new Set([options[0].id]) : new Set<string>()
    return new Set<string>()
  })
  const [pending, setPending] = useState<string | null>(null)
  // The auto-advance is offered whenever there's a next section left to open -
  // closed or first, not all (see the block's resolveFields) - so it's wired up
  // for either.
  const autoNext = initial !== 'all' && onSelect !== 'none'

  useIsomorphicLayoutEffect(() => {
    if (!pending) return
    const idx = options.findIndex((o) => o.id === pending)
    // Not simply the section after this one: the very pick being drained may have
    // auto-settled the option(s) that follow it (withAutoSelected - one reachable
    // value, chosen for the shopper, drawn without a toggle). A settled section
    // cannot open and needs nothing from the shopper, so advancing onto it left
    // the reveal stalled there. The section to open is the first one after the
    // pick still without an answer.
    const nextId = idx >= 0 ? options.slice(idx + 1).find((o) => !sel.optionValues[o.id])?.id : undefined
    // Draining a one-shot "a choice was made" signal after the reveal render, not
    // deriving render state; the guard above makes it fire once per choice.
    setPending(null)
    if (idx < 0) return
    setOpenIds((prev) => {
      const s = new Set(prev)
      if (onSelect === 'openNextCloseCurrent') s.delete(pending)
      if (nextId) s.add(nextId)
      return s
    })
  }, [pending, options, onSelect, sel.optionValues])

  const toggle = (id: string) => setOpenIds((prev) => {
    const s = new Set(prev)
    if (s.has(id)) s.delete(id); else s.add(id)
    return s
  })

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {options.map((option, index) => {
        // How many of this option's values the shopper can still reach given the
        // picks above it. A section with one or none has nothing left to decide -
        // its single value is already auto-chosen upstream (withAutoSelected) - so
        // it must not open, and offers no toggle: a header with a disclosure the
        // shopper cannot usefully use is just noise. It goes back to a normal,
        // openable section the moment an upstream change widens it past one again.
        const availableCount = option.values.filter((v) => sel.isAvailable(option.id, v.id)).length
        // Where out-of-reach choices are on show, they are part of what the panel
        // has to say - "available in 160 to 180cm" is the whole point of them - so
        // the section stays openable even when only one choice can actually be
        // picked. Hidden, there would be nothing behind the disclosure but the
        // one value already chosen for the shopper.
        const collapsible = (unavailable === 'show' ? option.values.length : availableCount) > 1
        const open = collapsible && openIds.has(option.id)
        const chosenId = sel.optionValues[option.id]
        const chosenLabel = chosenId ? option.values.find((v) => v.id === chosenId)?.label ?? null : null
        const panelId = `svr-acc-${option.id}`
        const headerStyle = {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
          width: '100%', padding: '0.625rem 0.875rem', textAlign: 'left' as const,
          background: 'var(--color-surface)', border: 'none',
          color: 'var(--color-text)', fontFamily: 'inherit',
          // The section no longer clips (see below), so the header rounds its own
          // corners to sit inside the section's 1px border rather than leaning on
          // an `overflow: hidden` to be trimmed.
          borderRadius: open ? '7px 7px 0 0' : 7,
        }
        const headerInner = (
          <>
            {/* The heading IS the option's label in this layout, so the numbered
                marker belongs here rather than on the control inside (which is
                drawn with its own label hidden). */}
            <span style={{ display: 'inline-flex', alignItems: 'center', fontWeight: 600, fontSize: '0.875rem' }}>
              <OptionNumber n={index + 1} done={!!chosenId} />
              {option.name}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              {chosenLabel && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{chosenLabel}</span>}
              {collapsible && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--color-text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-base, 0.15s)' }}>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              )}
            </span>
          </>
        )
        return (
          // Deliberately NOT `overflow: hidden`: a swatch's hover preview is
          // absolutely positioned and pops above its button, so clipping the
          // section sliced every preview off at the section's own border. The
          // header and panel round their own corners instead (above/below), and
          // the preview - being positioned, with its own z-index - paints over
          // the sections around it.
          <div key={option.id} style={{ border: '1px solid var(--color-border)', borderRadius: 8 }}>
            {collapsible ? (
              <button
                type="button" onClick={() => toggle(option.id)} aria-expanded={open} aria-controls={panelId}
                style={{ ...headerStyle, cursor: 'pointer' }}
              >
                {headerInner}
              </button>
            ) : (
              <div style={headerStyle}>{headerInner}</div>
            )}
            {open && (
              <div id={panelId} style={{ padding: '0.75rem 0.875rem', borderTop: '1px solid var(--color-border)', borderRadius: '0 0 7px 7px' }}>
                <OptionControl
                  option={option} sel={sel} hideLabel swatchDisplay={swatchDisplay} swatchPreview={swatchPreview} unavailable={unavailable} unavailableOrder={unavailableOrder}
                  onChoose={autoNext ? () => setPending(option.id) : undefined}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// The one hover affordance a colour/image choice has: a bordered surface chip
// above the swatch carrying a bigger look at the value (the full picture, or a
// proper block of colour), its name, or both. The pill look already shows the
// name, so it asks for the preview alone; the swatch-only look always asks for
// the name and adds the preview above it when previews are on.
//
// `sub` is the same line the pill choices print under their name - where an
// out-of-reach choice IS to be had ("available in 160 to 180cm"). The swatch-only
// look gave up its text to show the colour bigger, so the chip is the only place
// that line can go, and `struck` puts the same strike through the name that the
// pill's own label carries.
//
// With nothing to show it gets out of the way entirely and renders the swatch on
// its own - no listeners, no wrapper state. The name also rides the button's
// `title` and `aria-label`, so it is never hover-only for a keyboard or screen
// reader shopper.
function ValuePeek({ label, sub, struck = false, preview, wrapStyle, children }: { label?: string; sub?: string | null; struck?: boolean; preview?: React.ReactNode; wrapStyle?: React.CSSProperties; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (!label && !preview) return <>{children}</>
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', ...wrapStyle }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
            zIndex: 20, whiteSpace: 'nowrap', pointerEvents: 'none',
            display: 'grid', justifyItems: 'center', gap: preview && label ? 4 : 0,
            background: 'var(--color-surface)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: preview ? 8 : 'var(--radius-sm, 4px)',
            boxShadow: preview ? 'var(--shadow-lg)' : 'var(--shadow-md)',
            padding: preview ? 4 : '2px 8px', fontSize: 'var(--text-xs, 0.75rem)',
          }}
        >
          {preview}
          {label && (
            // Name over sub-line, mirroring the pill: a grid so the pair stays
            // centred as a block whatever the sub-line's width, and so a value
            // with no sub-line renders exactly the single centred name it always
            // did. The strike belongs to the name alone - it struck the line
            // underneath too when it sat on the wrapper, and that line is the one
            // part of an out-of-reach choice the shopper is meant to read.
            <span style={{ display: 'grid', justifyItems: 'center', lineHeight: 1.3, padding: preview ? '0 4px 2px' : 0 }}>
              <span style={{ textDecoration: struck ? 'line-through' : 'none' }}>{label}</span>
              {sub && (
                // Wraps, unlike the rest of the chip: a list of upstream values
                // ("available in 160, 180 or 200cm") can run long, and a chip
                // wider than the page is worse than two tidy lines.
                <span style={{
                  whiteSpace: 'normal', maxWidth: 180, textAlign: 'center',
                  fontWeight: 600, color: 'var(--color-text-muted)',
                }}>
                  {sub}
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

// A swatch picture, fetched in CORS mode.
//
// `crossOrigin` looks like it has no business on a product page, and it is here for
// one specific reason: on a product with a 3D view, the viewer paints this very same
// picture onto the model, and WebGL will only upload a cross-origin image that was
// fetched WITH CORS - so three's texture loader always asks for it that way. A browser
// files a CORS response and a plain one as two SEPARATE cache entries, which meant the
// swatch the shopper was already looking at could not satisfy the viewer's request and
// the whole file came down a second time on the first pick of every colour. Asking for
// it in the same mode here makes the two one download, and the colour lands from cache.
//
// Media served by the site's own worker answers with `Access-Control-Allow-Origin`, so
// this costs nothing there. A swatch pointed at some other host that does not is what
// the fallback is for: the attribute is dropped and the picture fetched plainly, exactly
// as before, rather than a shopper being shown a broken image for the sake of a
// speed-up. `crossOrigin` is written BEFORE `src` because that is the order React sets
// them in, and the attribute only counts if it is there when the load starts - which is
// also why the retry remounts the element rather than editing it in place.
function SwatchImg({ src, style }: { src: string; style: React.CSSProperties }) {
  // The url that would not load in CORS mode, rather than a plain "off" flag: the
  // fallback belongs to the picture that failed, so a value showing a different
  // picture gets its own fresh attempt with no effect to reset anything.
  const [refused, setRefused] = useState<string | null>(null)
  const cors = refused !== src
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- media library URLs are arbitrary remote hosts, not a configured next/image loader */
    <img
      key={cors ? 'cors' : 'plain'}
      crossOrigin={cors ? 'anonymous' : undefined}
      src={src}
      onError={() => setRefused(src)}
      alt=""
      aria-hidden
      style={style}
    />
  )
}

// The enlarged look a preview pops: the picture itself for an image value, and
// for a colour value the same colour drawn big enough to actually judge, since a
// 16px dot tells a shopper very little about a paint or a fabric.
function ValuePreview({ src, colour }: { src?: string; colour?: string }) {
  if (src) {
    return <SwatchImg src={src} style={{ width: 200, height: 200, objectFit: 'contain', display: 'block', borderRadius: 4 }} />
  }
  return <span aria-hidden style={{ width: 160, height: 90, display: 'block', borderRadius: 4, background: colour, border: '1px solid var(--color-border)' }} />
}

// Sits alongside the live price, in both hosts (see DetailSlotPartsClient), and
// puts the shopper back to an unchosen page. Both hosts lay their price out as a
// baseline-aligned flex row, so the gap that holds it clear of the figure is the
// control's own - one control, one look, wherever the price happens to be.
// A button rather than an anchor: it goes nowhere, and a keyboard or screen
// reader shopper should be told as much.
export function ResetOptionsLink({ sel }: { sel: ReturnType<typeof useVariationSelection> }) {
  if (!sel.anyOptionChosen) return null
  return (
    <button
      type="button" onClick={() => sel.resetOptions()}
      style={{
        marginLeft: '2.5rem', padding: 0, background: 'none', border: 'none',
        color: 'var(--color-text-muted)', fontFamily: 'inherit', fontSize: '0.8125rem',
        fontWeight: 400, whiteSpace: 'nowrap',
        textDecoration: 'underline', cursor: 'pointer',
      }}
    >
      Reset options
    </button>
  )
}

// Exported so the slot parts (DetailSlotParts.tsx) render the identical control
// inside shop's own detail chrome - one control, two hosts.
export function OptionControl({ option, sel, index, labelPlacement = 'above', hideLabel = false, swatchDisplay = 'pill', swatchPreview = 'show', unavailable = 'show', unavailableOrder = 'keep', onChoose }: { option: SvrOptionWithValues; sel: ReturnType<typeof useVariationSelection>; index?: number; labelPlacement?: OptionLabelPlacement; hideLabel?: boolean; swatchDisplay?: SwatchDisplay; swatchPreview?: SwatchPreview; unavailable?: UnavailableDisplay; unavailableOrder?: UnavailableOrder; onChoose?: () => void }) {
  const chosen = sel.optionValues[option.id]
  // A pick an upstream change has just made unreachable: shown struck through
  // and disabled rather than dropped, so the shopper sees it was there and why
  // it no longer fits. Null when the current pick still fits (or there isn't one).
  const ghost = sel.ghostValue(option.id)
  // Where an out-of-reach choice IS to be had, as the line printed under it:
  // "available in 160 to 180cm", or "available With Headrest" for a value whose
  // own label already carries the preposition. The whole phrase comes from the
  // hook rather than being glued together here, because only the hook knows which
  // of the two it is. Empty when no single upstream pick is the culprit, in which
  // case there is nothing honest to point the shopper at and the choice simply
  // reads as unavailable.
  const availabilityNote = (v: SvrOptionWithValues['values'][number]) => sel.availabilityNote(option.id, v.id)
  // The last-resort wording when neither a note nor a single clashing pick
  // explains a value away. "Out of Stock" wherever that is the actual reason -
  // a shopper can act on it (come back, ask when it lands) where "unavailable"
  // only shrugs. The generic word is kept for the rest: a combination ruled out
  // by several picks at once is not a stock problem and must not claim to be.
  const unavailableWord = (v: SvrOptionWithValues['values'][number]) =>
    sel.isOutOfStock(option.id, v.id) ? 'Out of Stock' : 'unavailable'
  const unavailableTitle = (v: SvrOptionWithValues['values'][number]) => {
    const note = availabilityNote(v)
    if (note) return `${v.label} - ${note}`
    const clash = sel.unavailableWith(option.id, v.id)
    return clash ? `Not available with ${clash}` : `${v.label} - ${unavailableWord(v)}`
  }
  // Which values the row draws. Under 'show' every one of them, so a choice the
  // picks above have ruled out still says its piece; under 'hide' only what the
  // shopper can actually pick - plus the current pick and any ghost, which stay
  // either way rather than letting the control blank out beneath them.
  const filteredValues = option.values.filter((v) =>
    unavailable === 'show' || sel.isAvailable(option.id, v.id) || chosen === v.id || ghost === v.id)
  // Under 'last', the choices that cannot be had drop to the end of the row.
  // A stable partition rather than a sort: within each half the shop's own order
  // is untouched, so a size run stays 120/140/160 and only the dead ones move.
  // Display only - the value ids, the selection and every availability answer
  // are exactly as they were, so nothing downstream can tell the difference.
  const shownValues = unavailableOrder === 'last'
    ? [
        ...filteredValues.filter((v) => sel.isAvailable(option.id, v.id)),
        ...filteredValues.filter((v) => !sel.isAvailable(option.id, v.id)),
      ]
    : filteredValues
  // Beside: the name sits on the first row of choices rather than above them.
  //
  // The name is FLOATED, not a flex item, and this is the whole trick. Flex would
  // keep the choices in a column to the right of the name, so every wrapped row
  // started under the first choice and the space beneath the name went to waste.
  // A float is taken out of flow and only the line boxes beside it are shortened,
  // so the first row clears the name and every row after it runs the full width -
  // choices wrap around the name the way text wraps around an image.
  //
  // That also means the choices CANNOT be a flex container: a flex container is a
  // block formatting context, and a BFC box is pushed aside by a float whole
  // rather than flowing around it. So they stay inline-level (the buttons are
  // already inline-flex) and space themselves with margins instead of `gap`.
  //
  // Containment is `flow-root`, deliberately not `overflow: hidden`: the image
  // swatch's hover peek is absolutely positioned and escapes its button, and
  // hidden would clip it.
  // In the accordion layout the heading already carries the name, so the control
  // drops its own label - and with it the beside float, which has nothing to sit
  // against.
  const beside = !hideLabel && labelPlacement === 'beside'
  const label = hideLabel ? null : (
    // inline-flex, not block, now that the name may carry a numbered marker: the
    // two have to sit on one baseline. The float path still works - a floated box
    // is block-level whatever `display` asked for - and the width is left to the
    // content so the float only shortens the line boxes it actually occupies.
    <span style={{
      fontWeight: 600, fontSize: '0.875rem', display: 'inline-flex', alignItems: 'center',
      ...(beside ? null : { marginBottom: '0.375rem' }),
      // Top padding is the pill's own top padding plus its border, so the name's
      // text sits on the same line as the text of the choices beside it.
      ...(beside ? { float: 'left' as const, marginRight: '0.75rem', paddingTop: '0.5rem' } : null),
    }}>
      {index != null && <OptionNumber n={index} done={!!chosen} />}
      {option.name}
    </span>
  )
  // The name is inline-flex now, so on the stacked path it needs a block wrapper
  // to sit on its own line above the choices - `display:block` on the span itself
  // would undo the flex the numbered marker needs.
  const labelRow = label && !beside ? <span style={{ display: 'block' }}>{label}</span> : label
  const rowStyle = beside ? { display: 'flow-root' } : undefined
  // Whether this option is one whose choices move the money. Worked out once here
  // rather than per value: it walks every value's variants, and the answer is the
  // same for all of them.
  const showPrices = sel.optionAffectsPrice(option.id)
  // Whether this option's choices are worth marking for the offer: some of them
  // lead to a reduced price and some do not. Worked out once, like the prices
  // above, and for the same reason. Where EVERY reachable choice is reduced there
  // is nothing to tell apart - a badge on all four of them would only repeat the
  // struck-through price beside the buy button - so the badges stay off and the
  // choices read as they always did. See optionHasSale in selection-logic.
  const markSale = sel.optionHasSale(option.id)

  if (option.controlType === 'DROPDOWN') {
    return (
      <label style={rowStyle}>
        {labelRow}
        <select
          value={chosen ?? ''} onChange={(e) => { sel.setOption(option.id, e.target.value); onChoose?.() }}
          style={{ padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', minWidth: 180, background: 'var(--color-surface)', color: 'var(--color-text)' }}
        >
          <option value="" disabled>Choose {option.name.toLowerCase()}</option>
          {/* An unbuyable combination is listed disabled, saying where it IS to
              be had, so a shopper who came for it is pointed at the pick that
              carries it. Set to 'hide' it drops out of the list entirely - bar
              the current pick and a pick an upstream change has just stranded
              (the ghost), which stay listed so the control never blanks out. */}
          {shownValues.map((v) => {
            const available = sel.isAvailable(option.id, v.id)
            // A native <option> takes text and nothing else, so the price hint the
            // pill controls put on a second line rides the label here instead.
            const hint = available && showPrices ? valuePriceHint(sel, option.id, v.id) : null
            const note = available ? '' : availabilityNote(v)
            // A native <option> takes no badge either, so the sale mark rides the
            // label as a word - the same place the price hint had to go.
            const sale = available && markSale && sel.valueOnSale(option.id, v.id)
            return <option key={v.id} value={v.id} disabled={!available} title={available ? undefined : unavailableTitle(v)}>{v.label}{sale ? ' - Sale' : ''}{hint ? ` - ${hint}` : ''}{available ? '' : ` - ${note || unavailableWord(v)}`}</option>
          })}
        </select>
      </label>
    )
  }

  // SWATCH, IMAGE and PILL all render as a row of buttons. SWATCH adds a colour
  // dot, IMAGE a thumbnail; both keep the label alongside, because a picture of a
  // fabric answers "which one is that?" and the label answers "what is it called?"
  // - and a shopper who cannot see the picture is left with only the second.
  const isSwatch = option.controlType === 'SWATCH'
  const isImage = option.controlType === 'IMAGE'
  // A swatch or image option can still hold values with no colour or picture set,
  // and a label on its own makes a shorter button than one carrying a 28px
  // thumbnail. The row reserves the height of its tallest possible content so a
  // half-filled option still reads as one tidy row rather than a broken fence.
  const mediaPx = isImage ? 28 : isSwatch ? 16 : 0
  return (
    <div style={rowStyle}>
      {labelRow}
      {/* Beside drops out of flex entirely (see the note above the float): the
          buttons lay out as inline boxes so their line boxes wrap around the
          floated name. `gap` does nothing to inline layout, so the spacing moves
          onto the buttons themselves, and the negative bottom margin swallows the
          one the last row would otherwise add under the option. */}
      <div style={beside
        ? { marginBottom: '-0.5rem' }
        : { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {/* An unbuyable value stays in the row, struck through and unpickable,
            with a line underneath naming where it IS to be had - see
            UnavailableDisplay. Set to 'hide' it drops out and only the current
            pick and a stranded one (the ghost) remain, so the row never empties. */}
        {shownValues.map((v) => {
          const available = sel.isAvailable(option.id, v.id)
          const active = chosen === v.id
          // Swatch-only drops the value's name to a hover tooltip and shows just
          // the swatch or thumbnail - but only for a value that actually carries
          // one. A colour/image value left blank keeps its text label rather than
          // rendering an empty button nobody could tell apart.
          const swatchOnly = swatchDisplay === 'swatchOnly' && (isSwatch || isImage) && !!v.swatch
          // The picture drawn on the page: the small rendition where one exists.
          // It is sized for the biggest thing here (the 200px hover preview), so
          // the full-size original - which the 3D viewer paints onto models at
          // true scale - is never downloaded just to fill a 28px thumbnail.
          const picture = v.swatchSmall ?? v.swatch
          // The enlarged look, when previews are on and the value has something
          // to enlarge. Both looks pop the same chip; they differ only in whether
          // the name rides along in it (the pill already shows the name).
          const previewNode = swatchPreview === 'show' && v.swatch && (isSwatch || isImage)
            ? <ValuePreview src={isImage ? picture ?? undefined : undefined} colour={isSwatch ? v.swatch : undefined} />
            : undefined
          // The second line under the value's name: where an out-of-reach choice
          // IS to be had, what it is when chosen, and what it would cost before
          // that - the last only where the option moves the money. The swatch-only
          // look has no room for it on the button, having given up its text to show
          // the colour bigger, so there it moves onto the hover chip instead
          // (peekSub, below) rather than being dropped.
          const note = available ? '' : availabilityNote(v)
          // Whether THIS choice is one of the reduced ones - the badge beside its
          // name. Only asked where the option has something to tell apart (see
          // markSale), and never of a choice the shopper cannot have: an
          // out-of-reach value's line is busy saying where it IS to be had, and a
          // sale badge on something unbuyable is an advert for a dead end.
          const onSale = available && markSale && sel.valueOnSale(option.id, v.id)
          const subLabel = swatchOnly ? null
            : !available ? (note || unavailableWord(v))
            : active ? 'Selected'
            : showPrices ? valuePriceHint(sel, option.id, v.id)
            : null
          // The out-of-reach line for the swatch-only chip: the same wording the
          // pill prints, under the name it already shows there. Only the
          // availability note travels, not "Selected", the price hint or the sale
          // mark - the tick badge says the first, the badge beside the swatch says
          // the last, and the chip is a hover affordance, no place to put money a
          // shopper has to hover to find.
          const peekSub = available ? null : (note || unavailableWord(v))
          // And for an out-of-reach swatch the chip has to hang on a WRAPPER round
          // the button rather than sit inside it: a disabled control takes no
          // pointer events, so a chip listening from within never hears the hover -
          // on precisely the value whose line the shopper needs (same reason the
          // locked buy button wears its title on a wrapper, further down).
          const peekOutside = swatchOnly && !available
          // The swatch-only look has no text of its own, so the name is the button's
          // aria-label - and for an out-of-reach value the whole sentence, since a
          // screen reader shopper gets neither the strike-through nor the hover chip
          // that carry it.
          const peekAria = available ? (onSale ? `${v.label} - on sale` : v.label) : unavailableTitle(v)
          // The swatch itself, hoisted out of the JSX below because it is rendered
          // either inside a hover chip or bare, depending on where the chip lives.
          const swatchNode = swatchOnly
            ? (isSwatch
                ? <span aria-hidden style={{ width: 16, height: 16, borderRadius: 999, background: v.swatch!, border: '1px solid var(--color-border)' }} />
                : <SwatchImg src={picture!} style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', display: 'block', border: '1px solid var(--color-border)' }} />)
            : null
          const button = (
            <button
              type="button" disabled={!available}
              onClick={() => { sel.setOption(option.id, v.id); onChoose?.() }}
              title={available ? peekAria : unavailableTitle(v)}
              aria-label={swatchOnly ? peekAria : undefined}
              aria-pressed={active}
              style={{
                position: 'relative',
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: isSwatch || isImage ? '0.375rem 0.5rem' : '0.375rem 0.75rem',
                boxSizing: 'border-box',
                // Padding (0.375rem each side) and the 2px border sit outside the
                // reserved media height, so a value with nothing to show matches
                // one that has.
                ...(mediaPx ? { minHeight: `calc(${mediaPx}px + 0.75rem + 4px)` } : null),
                borderRadius: 999,
                // Dashed for a choice that isn't on offer here: the shape says
                // "not one of these" at a glance, before the strike-through or
                // the line underneath are read at all.
                border: `2px ${available ? 'solid' : 'dashed'} ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                // A chosen value is tinted rather than filled solid: the label and
                // its "Selected" line still have to read, and a wash of the theme's
                // primary over the surface colour keeps the text contrast the
                // surface already had - in both light and dark - while saying
                // plainly that this one is picked. The tick badge does the rest.
                background: active
                  ? 'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface))'
                  : 'var(--color-surface)',
                color: available ? 'var(--color-text)' : 'var(--color-text-muted)',
                cursor: available ? 'pointer' : 'not-allowed',
                // Muted text and a dashed edge carry "not here" on their own. The
                // old 0.4 wash is gone deliberately: the line underneath now says
                // which size DOES carry the choice, and a note faded past reading
                // is worse than no note at all.
                textDecoration: 'none',
                fontSize: '0.875rem',
                // Beside lays these out inline, so they carry their own spacing
                // (the wrapper's `gap` only works on the flex path). `top` keeps a
                // row level whatever height its tallest button is, rather than
                // letting an image swatch's baseline drag the row about.
                ...(beside ? { marginRight: '0.5rem', marginBottom: '0.5rem', verticalAlign: 'top' as const } : null),
              }}
            >
              {/* Overlaps the button's own corner, so it needs the button to be a
                  positioned ancestor (above) and must not be clipped - which is why
                  nothing in this row uses overflow:hidden. */}
              {active && <ChosenTick />}
              {swatchOnly ? (
                // Swatch or thumbnail alone: the name has nowhere else to go, so it
                // always rides the hover chip, with the enlarged preview above it
                // when previews are on. An out-of-reach one gets the same chip from
                // the wrapper outside the button instead (peekOutside), so the swatch
                // goes in bare here and is not double-wrapped.
                // The badge sits OUTSIDE the hover chip's wrapper, beside the
                // swatch rather than inside the thing that pops up over it: a
                // colour shown without its name still has to say it is reduced
                // while the shopper is only looking, not pointing. It turns the
                // button from a bare dot into a short pill, which is the point -
                // an offer nobody can see is not an offer.
                <>
                  {peekOutside ? swatchNode : <ValuePeek label={v.label} sub={peekSub} preview={previewNode}>{swatchNode}</ValuePeek>}
                  {onSale && <SaleBadge spaced={false} />}
                </>
              ) : (
                <>
                  {/* The pill shows the name already, so its hover chip carries the
                      preview alone - and nothing at all when previews are off. */}
                  {isSwatch && v.swatch && (
                    <ValuePeek preview={previewNode}>
                      <span aria-hidden style={{ width: 16, height: 16, borderRadius: 999, background: v.swatch, border: '1px solid var(--color-border)' }} />
                    </ValuePeek>
                  )}
                  {isImage && picture && (
                    <ValuePeek preview={previewNode}>
                      <SwatchImg src={picture} style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', display: 'block', border: '1px solid var(--color-border)' }} />
                    </ValuePeek>
                  )}
                  {/* Name over sub-line. A grid rather than two spans so the pair
                      stays centred as a block whatever the sub-line's width, and so
                      a value with no sub-line renders exactly as it always did -
                      one centred label, same height. */}
                  <span style={{ display: 'grid', justifyItems: 'center', lineHeight: 1.2 }}>
                    {/* The strike belongs to the name alone. On the button it
                        struck the line underneath too, which is the one part of an
                        out-of-reach choice the shopper is meant to read. */}
                    {/* The badge sits on the name's own line, so a reduced choice
                        reads as "180cm Sale" and the sub-line underneath is left
                        to the money. The strike stays on the name alone. */}
                    <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <span style={{ textDecoration: available ? 'none' : 'line-through' }}>{v.label}</span>
                      {onSale && <SaleBadge />}
                    </span>
                    {subLabel && (
                      <span style={{
                        fontSize: '0.75rem', fontWeight: active || !available ? 600 : 400,
                        color: active ? 'var(--color-primary)' : 'var(--color-text-muted)',
                      }}>
                        {subLabel}
                      </span>
                    )}
                  </span>
                </>
              )}
            </button>
          )
          // `verticalAlign` moves to the wrapper on the beside path: the wrapper is
          // now the inline box the row aligns, and left at its baseline default an
          // image swatch would drag the row about. The button keeps its own margins -
          // they still space the wrapper, being its only content.
          return peekOutside ? (
            <ValuePeek
              key={v.id} label={v.label} sub={peekSub} struck preview={previewNode}
              wrapStyle={beside ? { verticalAlign: 'top' } : undefined}
            >
              {button}
            </ValuePeek>
          ) : <Fragment key={v.id}>{button}</Fragment>
        })}
      </div>
    </div>
  )
}

// ---- Personalisation -----------------------------------------------------
export type VariantPersonalisationPartProps = PartProps & { heading?: string }

export function VariantPersonalisationPart({ preview, slug: explicitSlug, initial, heading }: VariantPersonalisationPartProps) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  if (preview) return <Skeleton label="Personalisation fields" />
  if (!slug || !sel.loaded) return null
  if (!sel.payload || sel.payload.addons.length === 0) return null

  return (
    <div style={{ display: 'grid', gap: '0.875rem' }}>
      {/* Nothing at all unless the shop asks for one, which is what this block
          has always drawn - the fields carry their own labels. */}
      {heading?.trim() && <h3 style={{ margin: 0, fontSize: '1.0625rem' }}>{heading.trim()}</h3>}
      {sel.payload.addons.map((addon) => (
        <AddonControl key={addon.id} addon={addon} value={sel.addonValues[addon.id]} onChange={(v) => sel.setAddon(addon.id, v)} currency={sel.currencySymbol} slug={slug} />
      ))}
    </div>
  )
}

// Exported alongside OptionControl for the same reason.
export function AddonControl({ addon, value, onChange, currency, slug }: { addon: SvrAddon; value: AddonValue; onChange: (v: AddonValue) => void; currency: string; slug: string }) {
  const priceHint = addon.config.flatPrice ? ` (+${money(addon.config.flatPrice, currency)})`
    : addon.config.pricePerChar ? ` (+${money(addon.config.pricePerChar, currency)}/character)` : ''
  const labelEl = (
    <span style={{ fontWeight: 600, fontSize: '0.875rem', display: 'block', marginBottom: '0.375rem' }}>
      {addon.label}{addon.required && <span style={{ color: 'var(--color-danger)' }}> *</span>}
      {priceHint && <span style={{ fontWeight: 400, color: 'var(--color-text-muted)' }}>{priceHint}</span>}
    </span>
  )
  const field = { padding: '0.5rem 0.75rem', borderRadius: 6, border: '1px solid var(--color-border)', width: '100%', background: 'var(--color-surface)', color: 'var(--color-text)' } as const
  const str = typeof value === 'string' ? value : ''

  return (
    <label style={{ display: 'block' }}>
      {labelEl}
      {addon.config.helpText && <span style={{ display: 'block', fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>{addon.config.helpText}</span>}
      {addon.type === 'TEXT' && <input value={str} maxLength={addon.config.maxLength} placeholder={addon.config.placeholder} onChange={(e) => onChange(e.target.value)} style={field} />}
      {addon.type === 'TEXTAREA' && <textarea value={str} maxLength={addon.config.maxLength} placeholder={addon.config.placeholder} rows={3} onChange={(e) => onChange(e.target.value)} style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />}
      {addon.type === 'NUMBER' && <input type="number" value={str} min={addon.config.min} max={addon.config.max} onChange={(e) => onChange(e.target.value)} style={field} />}
      {addon.type === 'DATE' && <input type="date" value={str} onChange={(e) => onChange(e.target.value)} style={field} />}
      {addon.type === 'CHECKBOX' && (
        <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {addon.config.placeholder || 'Yes'}
        </label>
      )}
      {addon.type === 'SELECT' && (
        <select value={str} onChange={(e) => onChange(e.target.value)} style={field}>
          <option value="">Choose…</option>
          {addon.config.choices?.map((c) => (
            <option key={c.value} value={c.value}>{c.label}{c.price ? ` (+${money(c.price, currency)})` : ''}</option>
          ))}
        </select>
      )}
      {addon.type === 'FILE' && <FileUpload addon={addon} value={value as AddonFileValue | undefined} onChange={onChange} slug={slug} />}
    </label>
  )
}

function FileUpload({ addon, value, onChange, slug }: { addon: SvrAddon; value: AddonFileValue | undefined; onChange: (v: AddonValue) => void; slug: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true); setError(null)
    const form = new FormData()
    form.append('file', file)
    form.append('slug', slug)
    form.append('addonId', addon.id)
    try {
      const res = await fetch('/api/m/shop-variations/public/upload', { method: 'POST', body: form })
      const data = await res.json()
      if (res.ok) onChange({ token: data.token, filename: data.filename, url: data.url })
      else setError(data.error ?? 'Upload failed')
    } catch {
      setError('Upload failed')
    }
    setBusy(false)
  }

  return (
    <div>
      {value?.filename ? (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>📎 {value.filename}</span>
          <button type="button" onClick={() => onChange(null)} style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>Remove</button>
        </div>
      ) : (
        <input type="file" accept={addon.config.allowedTypes} disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      )}
      {busy && <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Uploading…</span>}
      {error && <span style={{ fontSize: '0.8125rem', color: 'var(--color-danger)' }}>{error}</span>}
    </div>
  )
}

// ---- Live price ----------------------------------------------------------
// The price line a product with options shows, dressed exactly as shop dresses
// one without: the figure in the site's display face, the struck-through price,
// the saving pill and the RRP all reading the same as they do on an ordinary
// product page. Same wording, same order, same sizes.
//
// The rules are copied rather than imported. Shop's own price part styles itself
// with a <style> of its own, and a layout carrying this block instead of that
// part never emits it - so relying on those class names would leave the figure
// in body text on precisely the pages this block is used. The declarations are
// the module's own, on its own class names, and every colour is a token.
const variantPriceCss = `
.svr-price-block{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.svr-price-now{font-family:var(--display-family,Georgia,serif);font-weight:600;font-size:var(--spd-price-size,34px);color:var(--color-primary)}
.svr-price-from{font-family:inherit;font-size:1rem;font-weight:400;color:var(--color-text-muted)}
.svr-price-was{font-size:15px;color:var(--color-text-muted);text-decoration:line-through}
.svr-price-save{background:var(--color-success-subtle);color:var(--color-success);font-size:12px;font-weight:600;border-radius:9999px;padding:4px 11px}
.svr-price-rrp{font-size:13px;color:var(--color-text-muted)}
.svr-price-note{font-size:13px;color:var(--color-text-muted)}
.svr-price-oos{font-size:0.875rem;font-weight:400;color:var(--color-danger)}
`

export type VariantPricePartProps = PartProps & {
  showCompare?: string
  showSave?: string
  showRrp?: string
  align?: string
}

export function VariantPricePart({ preview, slug: explicitSlug, initial, showCompare, showSave, showRrp, align }: VariantPricePartProps) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  if (preview) return <Skeleton label="Variant price" />
  if (!slug || !sel.loaded || !sel.payload) return null
  // Until a full combination is settled, the exact price is unknown, so show the
  // cheapest as "From £…" rather than the parent's own (which is not on sale and
  // may be the dearest). Once every option is chosen the resolved price stands.
  // Where the choices all cost the same there is no range to count up from, so
  // the one price shows plain - the hook already puts that figure in `price`.
  const showFrom = sel.hasOptions && !sel.allOptionsChosen && sel.priceVaries
  const onOffer = !showFrom && sel.compareAtPrice != null && sel.compareAtPrice > sel.price
  // Whole percent off, worked out against the struck-through figure - the same
  // sum shop does, so the two blocks can never quote different savings on the
  // same money.
  const savePct = onOffer && sel.compareAtPrice ? Math.round(((sel.compareAtPrice - sel.price) / sel.compareAtPrice) * 100) : null
  // A range has no single RRP worth quoting either: the cheapest combination's
  // list price says nothing about the one the shopper ends up on.
  const rrp = !showFrom && showRrp !== 'no' ? sel.retailPrice : null
  return (
    <div className="svr-price-block" style={align === 'center' || align === 'right' ? { justifyContent: align === 'right' ? 'flex-end' : 'center', textAlign: align } : undefined}>
      <style dangerouslySetInnerHTML={{ __html: variantPriceCss }} />
      {showFrom
        ? <span className="svr-price-now"><span className="svr-price-from">From </span>{money(sel.fromPrice, sel.currencySymbol)}</span>
        : <span className="svr-price-now">{money(sel.price, sel.currencySymbol)}</span>}
      {/* The chosen combination's own normal price, struck through, when that
          combination is the one on offer. Not while showing a "From" range -
          there is no single figure to strike against. */}
      {showCompare !== 'no' && onOffer && sel.compareAtPrice != null && (
        <span className="svr-price-was">{money(sel.compareAtPrice, sel.currencySymbol)}</span>
      )}
      {showSave !== 'no' && savePct != null && savePct > 0 && <span className="svr-price-save">Save {savePct}%</span>}
      {/* The maker's list price, when the shop shows one and it sits above what
          is being charged. */}
      {rrp != null && <span className="svr-price-rrp">RRP {money(rrp, sel.currencySymbol)}</span>}
      {/* Only once there's a combination to be out of stock. Nothing chosen is
          not the same as nothing available, and saying so over the parent's
          price would turn every options product into a sold-out one. */}
      {sel.hasOptions && sel.allOptionsChosen && !sel.inStock && <span className="svr-price-oos">Out of stock</span>}
      {/* Which side of tax the figure beside it sits on, where the shop has set
          the wording. The payload arrives already converted to match. */}
      {sel.priceSuffix && <span className="svr-price-note">{sel.priceSuffix}</span>}
      <ResetOptionsLink sel={sel} />
    </div>
  )
}

// ---- Add to cart ---------------------------------------------------------
export function VariantAddToCartPart({ preview, slug: explicitSlug, initial, label }: PartProps & { label?: string }) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  if (preview) return <Skeleton label="Add to basket" />
  if (!slug || !sel.loaded || !sel.payload) return null

  // Why the button is locked, naming the options still outstanding rather than
  // waving at "your options" - a shopper eight pickers down a long configuration
  // should not have to audit the page to find the one they missed.
  const reason = !sel.allOptionsChosen ? (missingOptionsSentence(sel.missingOptionNames) ?? 'Choose your options')
    : sel.hasOptions && !sel.inStock ? 'Out of stock'
    : !sel.addonPricing.valid ? (sel.addonPricing.reason ?? 'Complete the required fields')
    : null

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <SelectionSummary sel={sel} />
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <input
          type="number" min={1} value={qty} aria-label="Quantity"
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          style={{ width: 64, padding: '0.5rem', borderRadius: 6, border: '1px solid var(--color-border)' }}
        />
        {/* The tooltip goes on a wrapper, not on the button: a disabled control
            takes no pointer events, so its own `title` never appears - which is
            exactly the state we need to explain. The wrapper takes the flex growth
            the button used to, and the button fills it. `minWidth: 0` lets it
            shrink on a narrow screen now the label inside no longer sets a floor
            of its own - FitLabel sizes the wording to whatever room is left. */}
        <span title={reason ?? undefined} style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <button
            type="button" disabled={!sel.canAdd}
            onClick={() => { if (sel.add(qty)) { setAdded(true); window.setTimeout(() => setAdded(false), 2000) } }}
            style={{
              flex: 1, minWidth: 0, background: sel.canAdd ? 'var(--color-primary)' : 'var(--color-bg-subtle)',
              color: sel.canAdd ? 'var(--color-on-primary)' : 'var(--color-text-muted)',
              border: 'none', borderRadius: 8, padding: '0.75rem 1.25rem', fontWeight: 600,
              cursor: sel.canAdd ? 'pointer' : 'not-allowed',
            }}
          >
            {/* The reason the button is locked IS the button's label while it is
                locked - a shopper reading the thing they are trying to press is
                told what it wants, with no second line to find. */}
            <FitLabel text={added ? 'Added ✓' : (reason ?? (label || 'Add to basket'))} />
          </button>
        </span>
      </div>
      <AdminStockNote sel={sel} />
      <AdminSkuNote sel={sel} />
    </div>
  )
}

// ---- Variant-aware gallery ----------------------------------------------
// `extras` are items another module contributed through shop's `shop.gallery-media`
// point, resolved by this block's RSC half. This block covers shop's Gallery slot,
// so it is the only strip on the page and owns showing them - see the note in
// variant-parts.rsc.tsx.
export type VariantGalleryPartProps = PartProps & {
  extras?: ShopGalleryExtra[]
  // How big the thumbnail strip's tiles are. Blank keeps the 56px this block
  // has always drawn - which is also the size the contributed 3D thumbnails
  // are styled to, hence the custom property rather than a literal.
  thumbSize?: number
}

export function VariantGalleryPart({ preview, slug: explicitSlug, initial, extras = [], thumbSize }: VariantGalleryPartProps) {
  const slug = useProductSlug(explicitSlug ?? null)
  const sel = useVariationSelection(slug, initial)
  const [override, setOverride] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ id: string; key: string } | null>(null)
  const variantImages = sel.variantImages
  // A stable key for the effect below: the array is rebuilt on every render, so
  // depending on it directly would reset the override on every pass.
  const variantImageKey = variantImages.join('|')

  // When the chosen variant brings its own images, snap the main view to the
  // first of them.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing the manual thumbnail override in response to a variant change is the intended reset, not derived render state
  useEffect(() => { setOverride(null) }, [variantImageKey])

  // Reset options puts the gallery back to the product's own pictures. Not just
  // the image: a contributed stage (a 3D model of the variation the shopper had
  // built) is handed back too, because it is the most specific "this is yours" on
  // the page and leaving it up after the picks have gone says the choice is still
  // live. Watching the reset counter rather than "nothing is chosen" is the point
  // - a page opens with nothing chosen and must keep its opening view.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- putting the chosen variation's view away in response to a reset is the intended reset, not derived render state
  useEffect(() => { setOverride(null); setPicked(null) }, [sel.resetEpoch])

  if (preview) return <Skeleton label="Variant gallery" />
  if (!slug || !sel.loaded || !sel.payload) return null

  const base = sel.payload.baseImages
  // Every image the chosen variant owns leads the strip, in its own order, with
  // the parent's gallery behind it. A variant photographed from four angles shows
  // all four, not just the one the stage happens to be on.
  //
  // The promoted variations' pictures bring up the rear, and stay there until a
  // whole combination resolves (see sel.featuredImages). Behind the product's own
  // rather than in front: they are extra colours on offer, not what the product
  // is.
  //
  // The owner can turn that round per product on the Images tab
  // (sel.baseImagesLast), putting the promoted variations first and the product's
  // own pictures behind them.
  const promoted = sel.featuredImages.map((url) => ({ url, alt: 'Another finish' }))
  const thumbs = [
    ...variantImages.map((url) => ({ url, alt: 'Selected variant' })),
    ...(sel.baseImagesLast ? [...promoted, ...base] : [...base, ...promoted]),
  ].filter((t, i, arr) => arr.findIndex((x) => x.url === t.url) === i)
  // An override the strip no longer offers is dropped rather than left on the
  // stage: a promoted variation's picture stops being on offer the moment their
  // combination resolves, and it may be the very one they had clicked.
  const held = override !== null && thumbs.some((t) => t.url === override) ? override : null
  const main = held ?? sel.image ?? (sel.baseImagesLast ? thumbs[0]?.url : base[0]?.url) ?? thumbs[0]?.url ?? null
  const activeExtra = picked ? extras.find((e) => e.id === picked.id) ?? null : null
  const activeProductId = sel.variant?.childProductId ?? null
  // Whether what is on the stage is the shopper's own configuration rather than
  // the product's general pictures: a contributed stage (their variation's 3D
  // model), or one of the variant's own photographs. A base photo they have
  // clicked back to is the catalogue's, not theirs, so it earns no pill.
  const showingChoice = sel.hasOptions && sel.allOptionsChosen
    && (activeExtra !== null || (main !== null && variantImages.includes(main)))

  // A product whose only picture is a contributed item still has a gallery worth
  // drawing, so this bails only when there is nothing at all to show.
  if (!main && extras.length === 0) return null
  const size = Number(thumbSize)
  const sizeVar = Number.isFinite(size) && size > 0 ? ({ ['--svr-thumb' as string]: `${size}px` } as React.CSSProperties) : undefined
  return (
    <div style={{ display: 'grid', gap: '0.5rem', ...sizeVar }}>
      {/* This block styles itself inline, but a contributed thumbnail is rendered
          by the module that supplied it and can only be handed class names. These
          two mirror the image thumbnails' inline style above, so a 3D thumbnail
          sits in the strip looking like the pictures either side of it rather
          than like an unstyled button. */}
      {extras.length > 0 && (
        <style dangerouslySetInnerHTML={{ __html: `
.svr-gallery-thumb{padding:0;border:2px solid var(--color-border);border-radius:8px;cursor:pointer;background:none;width:var(--svr-thumb,56px);height:var(--svr-thumb,56px);overflow:hidden;display:block;position:relative}
.svr-gallery-thumb.on{border-color:var(--color-primary)}
` }} />
      )}
      {/* The stage, wrapped so the "Your choice" pill has a positioned box to sit
          in the corner of - whichever of the two things is on it. */}
      <div style={{ position: 'relative' }}>
        {showingChoice && <YourChoicePill />}
        {activeExtra && picked ? (
          <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--color-border)' }}>
            <activeExtra.Stage payload={activeExtra.payload} itemKey={picked.key} activeProductId={activeProductId} />
          </div>
        ) : main ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={main} alt={sel.payload.productName} style={{ width: '100%', borderRadius: 10, objectFit: 'cover', aspectRatio: '1 / 1', border: '1px solid var(--color-border)' }} />
        ) : null}
      </div>
      {thumbs.length + extras.length > 1 ? (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {/* Contributed media (a 3D model, say) leads the strip, so the richer
              view sits first rather than trailing behind the photos - it is also
              what the stage opens on, and the two should agree. */}
          {extras.map((extra) => (
            <extra.Thumbs
              // Reset counter in the key: a contributor may hold state of its own
              // about the variation the shopper had settled on, and a null
              // activeProductId cannot tell it a reset from a mid-reconfigure gap.
              // See the same note in DetailSlotPartsClient.
              key={`${extra.id}:${sel.resetEpoch}`}
              payload={extra.payload}
              activeProductId={activeProductId}
              // The promoted variations, so a contributor shows their media too
              // before a whole combination is settled. Empty from the moment one
              // resolves (see the same note in DetailSlotPartsClient).
              featuredProductIds={sel.featuredModelChildIds}
              activeKey={picked?.id === extra.id ? picked.key : null}
              onPick={(key) => setPicked(key === null ? null : { id: extra.id, key })}
              thumbClass="svr-gallery-thumb"
              thumbOnClass="svr-gallery-thumb on"
            />
          ))}
          {thumbs.map((t) => (
            <button key={t.url} type="button" onClick={() => { setOverride(t.url); setPicked(null) }} style={{ padding: 0, border: `2px solid ${main === t.url && !picked ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 8, cursor: 'pointer', background: 'none' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.url} alt={t.alt} style={{ width: 'var(--svr-thumb, 56px)', height: 'var(--svr-thumb, 56px)', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
            </button>
          ))}
        </div>
      ) : (
        // A lone contributed item still has to mount: unlike a lone photo (already
        // showing via `main`, no click required), a lone extra's stage only ever
        // appears once its Thumbs component's own effect calls onPick - that is
        // where "lead with the model" lives (see Gallery3dThumbs). No picker is
        // needed with nothing to pick between, so it mounts invisibly rather than
        // inside the visible strip.
        extras.map((extra) => (
          // Keyed on the reset counter for the same reason as the visible strip.
          <div key={`${extra.id}:${sel.resetEpoch}`} style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} aria-hidden="true">
            <extra.Thumbs
              payload={extra.payload}
              activeProductId={activeProductId}
              featuredProductIds={sel.featuredModelChildIds}
              activeKey={picked?.id === extra.id ? picked.key : null}
              onPick={(key) => setPicked(key === null ? null : { id: extra.id, key })}
              thumbClass="svr-gallery-thumb"
              thumbOnClass="svr-gallery-thumb on"
            />
          </div>
        ))
      )}
    </div>
  )
}
