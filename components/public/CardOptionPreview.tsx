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
import { resolvePreviewSource, type CardOptionSummary, type CardOptionsPreview } from '@/modules/shop-variations/lib/card-options'
import { OptionRow, cardOptionsRootStyle, type InteractiveValue } from '@/modules/shop-variations/components/public/card-option-rows'

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
  options,
  preview,
  dragRef,
}: {
  options: CardOptionSummary[]
  preview?: CardOptionsPreview
  // Puck's drag handle, on the part's own root element - see the block for why it
  // must not be wrapped in a div of its own.
  dragRef?: (element: Element | null) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
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

  const source = resolvePreviewSource(preview, picks)

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
      if (vi === undefined || !preview) return null
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
    [options, preview, pinned, picks, point, pin],
  )

  return (
    <div
      style={islandStyle}
      ref={(element) => {
        rootRef.current = element
        dragRef?.(element)
      }}
    >
      {options.map((option, i) => (
        <OptionRow key={option.id} option={option} optionIndex={i} interactive={interactive} />
      ))}
    </div>
  )
}
