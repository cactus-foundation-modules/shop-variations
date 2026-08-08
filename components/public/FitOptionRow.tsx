'use client'

// The measuring half of "show as many values as fit on N lines". The server
// cannot know how wide a card will be drawn - that depends on the shopper's
// screen and the grid's column count - so a fit-mode row ships every value it
// might need (capped upstream, see FIT_VALUE_CAP) and this component counts what
// actually fits once the row is on a real card.
//
// The method leans on a property of inline flow: items lay out greedily left to
// right, so the position of the first k chips does not depend on what comes after
// them. One render with EVERYTHING in place (values visible, the "+n" marker
// occupying its space invisibly, the row clamped to the allowed lines so nothing
// tall flashes) is therefore enough to answer every "what if only k showed?"
// question at once:
//
//   - each chip's line is read off its top edge (a jump of more than half a line
//     height starts a new line - chips on one line may sit a pixel or two apart
//     where swatches and text mix);
//   - k starts at the number of chips inside the allowed lines and walks down
//     until the marker also fits: trivially, when the last shown chip ends before
//     the final allowed line; by width, when it ends on it. The marker is
//     measured at its widest possible figure, so a shrinking count can only ever
//     free space, never steal it.
//
// The trim then happens in useLayoutEffect, before the browser paints, so
// shoppers never see the untrimmed state. Values past the cut go display:none
// rather than unmounting - the next re-measure (a resize, a web font arriving
// late) just turns them back on. Without JavaScript the measuring never runs and
// the clamp itself is the graceful fallback: the allowed lines show, full, with
// no marker.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CardOptionSummary } from '@/modules/shop-variations/lib/card-options'
import { OptionRow, type FitState, type ValueInteraction } from '@/modules/shop-variations/components/public/card-option-rows'

export function FitOptionRow({
  option,
  optionIndex,
  interactive,
}: {
  option: CardOptionSummary
  optionIndex: number
  interactive?: ValueInteraction
}) {
  const rowRef = useRef<HTMLSpanElement>(null)
  // null = measuring: everything rendered, clamped, marker invisible. Also the
  // server-rendered and no-JavaScript state, so hydration matches.
  const [shown, setShown] = useState<number | null>(null)
  const measuredWidth = useRef(-1)

  // Everything the card COULD show, marker included - what the marker prints
  // while its width is being measured, and the pool the settled count is
  // subtracted from. `option.more` is the tail the server already trimmed at the
  // payload cap; those values are as hidden as the ones trimmed here.
  const total = option.values.length + option.more

  // A different option (a filter re-rendering the grid with new facts) starts the
  // measurement over - adjusted during render, the sanctioned shape for state
  // that answers to a prop, so the stale count never reaches the screen. A card
  // changing width or a late-arriving web font does the same from below (fonts
  // change every chip's width, and a wrong first measure would otherwise stand
  // for good).
  const [measuredFor, setMeasuredFor] = useState(option)
  if (measuredFor !== option) {
    setMeasuredFor(option)
    setShown(null)
  }
  useEffect(() => {
    const row = rowRef.current
    if (!row || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (Math.abs(width - measuredWidth.current) > 1) setShown(null)
    })
    observer.observe(row)
    let stale = false
    document.fonts?.ready.then(() => { if (!stale) setShown(null) }).catch(() => {})
    return () => { stale = true; observer.disconnect() }
  }, [])

  useLayoutEffect(() => {
    if (shown !== null) return
    const row = rowRef.current
    if (!row) return
    const rowRect = row.getBoundingClientRect()
    measuredWidth.current = rowRect.width
    const items = Array.from(row.querySelectorAll<HTMLElement>('[data-fit-item]'))
    if (items.length === 0) { setShown(0); return }
    const lines = Math.max(1, option.fit ?? 1)
    const lineHeightPx = Number.parseFloat(getComputedStyle(row).lineHeight) || 16

    // Which line each chip landed on. Tops within half a line height of the
    // previous chip are the same line; a bigger drop starts the next one.
    const rects = items.map((item) => item.getBoundingClientRect())
    const lineOf: number[] = []
    let line = 0
    for (let i = 0; i < rects.length; i++) {
      if (i > 0 && rects[i]!.top - rects[i - 1]!.top > lineHeightPx / 2) line++
      lineOf.push(line)
    }

    const marker = row.querySelector<HTMLElement>('[data-fit-more]')
    const markerWidth = marker ? marker.getBoundingClientRect().width : 0
    const gap = Number.parseFloat(getComputedStyle(items[0]!).marginRight) || 0

    // Would showing exactly k values leave the marker somewhere legal? The
    // marker follows the last shown chip in flow, so: fine anywhere before the
    // final allowed line, needs the leftover width on it, impossible past it.
    const fits = (k: number): boolean => {
      if (k === 0) return true
      const lastLine = lineOf[k - 1]!
      if (lastLine >= lines) return false
      if (total - k === 0) return true
      if (lastLine < lines - 1) return true
      return rects[k - 1]!.right - rowRect.left + gap + markerWidth <= row.clientWidth
    }

    let k = 0
    while (k < items.length && lineOf[k]! < lines) k++
    while (k > 0 && !fits(k)) k--
    setShown(k)
  }, [shown, option, total])

  const fit: FitState = {
    rowRef,
    shown,
    // While measuring, the marker holds space for the biggest figure it could
    // ever need to print, so the width read off it is a ceiling, not a guess.
    moreCount: shown == null ? total : total - shown,
  }
  return <OptionRow option={option} optionIndex={optionIndex} interactive={interactive} fit={fit} />
}
