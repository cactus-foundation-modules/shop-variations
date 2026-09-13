'use client'

// The interactive half of the "Card: Variation options" block. The values a card
// prints under a product's name become things a shopper can point at: hover (or
// tap) 120cm and the tile shows the 120cm desk, then walnut and it shows the 120cm
// walnut one, then a black frame and it shows that. Choices accumulate down the
// rows, so the picture is always the combination pointed at so far.
//
// It does NOT touch the <img>. Shop's card carousel owns that, and writing the src
// from outside is undone by its next render (the filters module learnt this the
// hard way). Instead this uses shop's published contract for exactly this job: the
// allowed photo `sourceId`s go into `data-shop-media-sources` on the `.shop-card`
// ancestor and a `shop:card-media-sources` event tells the island to re-read. The
// island then shows that photo and hands its active sourceId to the card's
// overlays - which is why the 3D icon opens on the SAME variation's model without a
// line of code here knowing 3D exists. One seam, both surfaces.
//
// The filters module writes that same attribute, so this one is a good neighbour:
// it remembers what was there before it touched anything, puts it back when the
// shopper moves off, and stands down entirely (dropping its own picks) if a filter
// writes while a preview is up - the shopper just asked for something narrower and
// a stale hover must not outrank it.
//
// Two kinds of choice, deliberately:
//   - hovering or focusing sets a working pick that lasts while the pointer is on
//     the card and reverts when it leaves, so a browse costs nothing;
//   - clicking or tapping pins one, which survives leaving the card. That is what
//     makes this work on a phone, where nothing hovers, and what keeps the picture
//     (and so the 3D model) on the chosen variation while the shopper travels
//     across the card to tap the 3D icon. Tapping a pinned value again unpins it.
//
// Rendered for the storefront AND the editor canvas, so the markup is identical in
// each; in the canvas there is no `.shop-card` ancestor and every handler simply
// finds nothing to talk to.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { resolvePreviewSource, type CardOptionsPreview } from '@/modules/shop-variations/lib/card-options'
import { unpackCardOptions, type PackedCardOptions } from '@/modules/shop-variations/lib/card-options-pack'
import { OptionRow, cardOptionsRootStyle, type InteractiveValue } from '@/modules/shop-variations/components/public/card-option-rows'
import { FitOptionRow } from '@/modules/shop-variations/components/public/FitOptionRow'
import type { ImageResizing } from '@/lib/media/resize-url'

const CARD_SELECTOR = '.shop-card'
const SOURCES_ATTR = 'data-shop-media-sources'
const SOURCES_EVENT = 'shop:card-media-sources'

// Above the card's stretched navigation link (z-index 1), which otherwise takes
// every tap meant for a swatch. Pointer events are off on the root and back on for
// the buttons alone, so the rest of the block stays click-through and tapping the
// words beside the swatches still opens the product - including in the overlay card
// layout, where shop's own CSS turns pointer events off for everything after the
// image and only an inline style outranks it.
const islandStyle: CSSProperties = { ...cardOptionsRootStyle, position: 'relative', zIndex: 2, pointerEvents: 'none' }

export function CardOptionPreview({
  options: packedOptions,
  preview,
  previewHref,
  resizing,
  dragRef,
}: {
  /** The card's summaries, folded for the trip - see lib/card-options-pack.ts.
   *  Unfolded once below, and every line after that works on the list it
   *  always did. */
  options: PackedCardOptions
  /** Handed in directly only by the Puck editor, which has a sample to draw and
   *  no route to fetch from. On a real page this arrives via `previewHref`. */
  preview?: CardOptionsPreview
  /** Where to fetch the variation matrix from, on the first sign of interest.
   *
   *  WHY IT IS NOT A PROP ANY MORE. The matrix answers "which photo is THIS
   *  combination?" and is needed only once somebody points at a swatch - but it
   *  was serialised into every card on every grid. Measured on the live
   *  homepage: 4,170 variant entries across 31 cards, 255 KB of flight payload,
   *  on a page where most visitors never hover a swatch at all.
   *
   *  The rows themselves are unaffected: they are server-rendered markup either
   *  way, their values buttons from the start, and a choice made in the moment
   *  before the answer arrives simply waits for it (see `valuesInteractive`). */
  previewHref?: string
  /** Passed through to the option rows so a swatch chip asks for a chip-sized
   *  source. See CHIP_PX in card-option-rows. */
  resizing?: ImageResizing
  // Puck's drag handle, on the part's own root element - see the block for why it
  // must not be wrapped in a div of its own.
  dragRef?: (element: Element | null) => void
}) {
  // The same list for the same packed object, every render - the picks below
  // are keyed on its identity and would reset on a fresh copy.
  const options = unpackCardOptions(packedOptions)
  const rootRef = useRef<HTMLDivElement>(null)
  // The matrix, once asked for. `preview` wins when present so the editor's
  // sample still draws without a request.
  const [fetched, setFetched] = useState<CardOptionsPreview | undefined>(undefined)
  // Set when the request failed or came back with nothing to preview, which puts
  // the values back to the plain labels they would be with the setting off.
  const [previewUnavailable, setPreviewUnavailable] = useState(false)
  const askedRef = useRef(false)
  const live = preview ?? fetched

  // Asked for on the first sign of interest in this card rather than on load: a
  // grid of thirty cards would otherwise make thirty requests for data most of
  // them never need. A mouse asks as it enters the TILE (see the effect below),
  // so by the time a shopper has crossed it to reach a swatch the answer has
  // usually landed; a card reached by keyboard or touch asks when a value is
  // focused or touched.
  //
  // One request per card, ever - `askedRef` is never cleared. A failure, or a
  // product with nothing to preview, puts the row back to plain labels, which is
  // the same card an owner who never switched the preview on has always had.
  const wantPreview = !preview && Boolean(previewHref)
  const askForPreview = useCallback(() => {
    if (!wantPreview || askedRef.current || !previewHref) return
    askedRef.current = true
    fetch(previewHref, { headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: CardOptionsPreview | null) => {
        if (json && Array.isArray(json.variants) && json.variants.length > 0) setFetched(json)
        else setPreviewUnavailable(true)
      })
      .catch(() => setPreviewUnavailable(true))
  }, [wantPreview, previewHref])

  // The values are buttons from the first paint, answer or no answer - exactly
  // what they were while the matrix still rode in the page. They have to be:
  // this block's root takes no pointer events (see islandStyle), so the only
  // things in it a pointer, a finger or the Tab key can ever reach are the
  // buttons, and a row left as plain labels until the answer arrived could never
  // be touched to ask for it - which is how the lazy request first shipped, with
  // the server-rendered rows holding nothing a pointer could land on. A choice
  // made before the answer lands is kept, and the photo follows the moment it
  // does.
  const valuesInteractive = Boolean(live) || (wantPreview && !previewUnavailable)

  // The tile-wide head start: the block's own root hears nothing until the
  // pointer is already on a value, so the card itself is listened to. Not for a
  // finger - one crossing a card is nearly always a scroll, and asking for every
  // card a thumb brushes past is the request per card this is built to avoid. A
  // tap on a value asks through the root's own handlers below.
  useEffect(() => {
    if (!wantPreview) return
    const card = rootRef.current?.closest<HTMLElement>(CARD_SELECTOR)
    if (!card) return
    const onCardEnter = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') askForPreview()
    }
    card.addEventListener('pointerenter', onCardEnter)
    return () => card.removeEventListener('pointerenter', onCardEnter)
  }, [wantPreview, askForPreview])
  // What the card's photos were constrained to before this block touched anything
  // (a filter's doing, or nothing at all). Restored whenever the preview clears.
  const baseRef = useRef<string | null>(null)
  // Set while we are the ones dispatching, so our own event does not read as
  // somebody else moving the ground under us.
  const ownWriteRef = useRef(false)

  // One slot per option, in the order the card prints them. `pinned` is what a tap
  // fixed; `picks` is what the shopper is pointing at now, which starts from
  // `pinned` and returns to it when they leave the card.
  const empty = useMemo<Array<number | null>>(() => options.map(() => null), [options])
  const [pinned, setPinned] = useState(empty)
  const [picks, setPicks] = useState(empty)
  // The card-leave listener is bound once, so it reads the current pins through a
  // ref rather than through the closure it was born with.
  const pinnedRef = useRef(pinned)
  useEffect(() => { pinnedRef.current = pinned }, [pinned])

  // Whether we have ever written to the card. Until we have, there is nothing to
  // undo, and a mount that "restored" would trample a constraint a filter had
  // already dressed the card with before this island hydrated.
  const touchedRef = useRef(false)

  const source = resolvePreviewSource(live, picks)

  // Remember what was on the card when we arrived, keep that memory current when
  // somebody else writes, and put it back on the way out. Declared BEFORE the
  // effect that writes, because effects run in source order and that one needs
  // the base already in hand on its first pass.
  useEffect(() => {
    const card = rootRef.current?.closest<HTMLElement>(CARD_SELECTOR)
    if (!card) return
    baseRef.current = card.getAttribute(SOURCES_ATTR)
    const onSources = () => {
      if (ownWriteRef.current) return
      baseRef.current = card.getAttribute(SOURCES_ATTR)
      setPinned(empty)
      setPicks(empty)
    }
    // Back to whatever was pinned once the pointer is off the card entirely - not
    // off this block, which would drop the preview on the way to the 3D icon.
    const onLeave = () => setPicks(pinnedRef.current)
    card.addEventListener(SOURCES_EVENT, onSources)
    card.addEventListener('mouseleave', onLeave)
    return () => {
      card.removeEventListener(SOURCES_EVENT, onSources)
      card.removeEventListener('mouseleave', onLeave)
      // Leave the card as it was found: a card unmounted mid-preview (a filter
      // re-rendering the grid) must not keep a colour nobody chose.
      if (!touchedRef.current) return
      if (baseRef.current !== null) card.setAttribute(SOURCES_ATTR, baseRef.current)
      else card.removeAttribute(SOURCES_ATTR)
      card.dispatchEvent(new CustomEvent(SOURCES_EVENT))
    }
  }, [empty])

  // Push the current pick onto the card, or take our constraint back off it. The
  // attribute is the single source of truth; the event only says "re-read it".
  useEffect(() => {
    const card = rootRef.current?.closest<HTMLElement>(CARD_SELECTOR)
    if (!card) return
    // Nothing pointed at and nothing of ours on the card: there is nothing to say,
    // and saying it would clear whatever a filter had put there.
    if (!source && !touchedRef.current) return
    if (source) card.setAttribute(SOURCES_ATTR, source)
    else if (baseRef.current !== null) card.setAttribute(SOURCES_ATTR, baseRef.current)
    else card.removeAttribute(SOURCES_ATTR)
    touchedRef.current = Boolean(source)
    ownWriteRef.current = true
    card.dispatchEvent(new CustomEvent(SOURCES_EVENT))
    ownWriteRef.current = false
  }, [source])

  const point = useCallback((optionIndex: number, vi: number) => {
    setPicks((current) => {
      if (current[optionIndex] === vi) return current
      const next = [...current]
      next[optionIndex] = vi
      return next
    })
  }, [])

  const pin = useCallback((optionIndex: number, vi: number) => {
    setPinned((current) => {
      const next = [...current]
      // Tapping the value that is already pinned takes it back off, so a shopper
      // can undo a choice with the control they made it with.
      next[optionIndex] = current[optionIndex] === vi ? null : vi
      setPicks(next)
      return next
    })
  }, [])

  const interactive = useCallback(
    (optionIndex: number, valueIndex: number): InteractiveValue | null => {
      const vi = options[optionIndex]?.values[valueIndex]?.vi
      // A value no variation answers to cannot be previewed, so it stays the plain
      // label it always was rather than offering a button that does nothing.
      if (vi === undefined || !valuesInteractive) return null
      return {
        pinned: pinned[optionIndex] === vi,
        active: picks[optionIndex] === vi,
        onMouseEnter: () => point(optionIndex, vi),
        onFocus: () => point(optionIndex, vi),
        onClick: (event) => {
          // The whole card is a stretched link under this block; without both of
          // these, choosing a colour would navigate to the product instead.
          event.preventDefault()
          event.stopPropagation()
          pin(optionIndex, vi)
        },
      }
    },
    [options, valuesInteractive, pinned, picks, point, pin],
  )

  return (
    <div
      style={islandStyle}
      ref={(element) => {
        rootRef.current = element
        dragRef?.(element)
      }}
      onPointerEnter={askForPreview}
      onFocusCapture={askForPreview}
      onTouchStart={askForPreview}
    >
      {/* Same split as the plain path: a "fit N lines" option measures itself,
          everything else renders straight through. Hidden values cannot be
          hovered, exactly like values trimmed by a fixed limit. */}
      {options.map((option, i) => (
        option.fit != null
          ? <FitOptionRow key={option.id} option={option} optionIndex={i} interactive={interactive} resizing={resizing} />
          : <OptionRow key={option.id} option={option} optionIndex={i} interactive={interactive} resizing={resizing} />
      ))}
    </div>
  )
}
