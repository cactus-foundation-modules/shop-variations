'use client'

// Pins the gallery to the top of a phone screen while the shopper scrolls the
// option pickers, so the picture (or 3D model) they are configuring stays in
// sight as they choose. Only products with options get this - the options list
// is what makes the buy column long enough to scroll the photo away in the
// first place - which is why it lives here and not in shop.
//
// Mobile is detected from the layout rather than a breakpoint: the Split stacks
// the buy column UNDER the gallery at the site's own mobile width, and that
// stacking (options below the gallery, sharing its column) is the exact
// condition the pin needs. Reading the geometry means the site's per-install
// breakpoint setting is honoured without threading it through shop's slot
// contract.
//
// Pinned, the column turns into a compact strip (CSS class `svr-mstick`,
// emitted by VariantSlotGalleryClient): the stage large, taking most of the
// width, with two of the remaining thumbnails stacked beside it and any beyond
// those two scrolling within. The pin
// starts when the normal gallery's bottom has scrolled up to where the compact
// strip ends (so the swap reads as the gallery catching on the header rather
// than popping in), and releases in both directions: scrolled back to the top
// of the page, the gallery drops back into the flow exactly as it was; scrolled
// on past the options, the strip lets go and leaves with them.
//
// The spacer holds the gallery's place in the flow while the column is fixed,
// so pinning never jumps the scroll position, and every threshold below can
// keep measuring the natural geometry while pinned.

import { useEffect, useRef, type RefObject } from 'react'

export const STICKY_GALLERY_CLASS = 'svr-mstick'

// Set on the page root while the compact strip is pinned, so shop's sticky tab
// bar (which pins to the same spot under the header, with the strip tucked
// below it) stays painted above the strip while the two hand over. The CSS
// that reads it lives beside the strip's own styling in DetailSlotPartsClient,
// since both restyle shop's classes from this module.
export const GALLERY_PINNED_CLASS = 'svr-gallery-pinned'

// The option pickers mark themselves with this (VariantSlotPurchaseClient's
// inline options area and the granular ShopVariantOptions block both wear it),
// so the hook can find where "scrolling the options" starts and stops without
// the two islands sharing refs.
export const OPTIONS_AREA_CLASS = 'svr-options'

// The published seam for anything else in the buy column that is part of
// configuring the purchase - the add-ons box being the case that prompted it.
// Those boxes sit BELOW the option pickers, so measuring the pickers alone let
// the strip go the moment the shopper scrolled into them, and the picture they
// were configuring left the screen exactly when they needed it. Any element
// carrying this attribute extends the pin's release point as if it were part of
// the options area; it carries no styling and needs no import beyond this
// constant.
export const GALLERY_HOLD_ATTR = 'data-svr-hold-gallery'

export function useStickyMobileGallery(enabled: boolean): {
  colRef: RefObject<HTMLDivElement | null>
  spacerRef: RefObject<HTMLDivElement | null>
} {
  const colRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!enabled) return
    const col = colRef.current
    const spacer = spacerRef.current
    if (!col || !spacer) return

    let pinned = false
    // Assigned below, once `update` exists to be the observer's callback; the
    // holders it watches are picked up as they appear, since the add-ons box
    // mounts after its own payload arrives.
    let ro: ResizeObserver | null = null
    const observed = new Set<Element>()
    // Measured once actually pinned; until then estimated as half the column's
    // width (the stage is square and takes half the row) so the first pin fires
    // at roughly the right scroll offset. A wrong estimate self-corrects on the
    // next scroll tick and the measured figure is kept from then on.
    let compactH = 0

    // Published on :root by shop's GalleryViewportFit, which the Gallery part
    // renders even when this module's gallery fills the slot. Tracks the live
    // height of a shrink-on-scroll header, so the pinned strip follows it.
    const headerH = (): number => {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spd-header-h'))
      return Number.isFinite(v) ? v : 96
    }

    // Shop's sticky tab bar publishes its measured height here (see
    // ProductSectionTabs); the pinned strip sits below the bar, so every
    // threshold that reasons about where the strip rests must add it on.
    // 0 when the author didn't make the bar sticky.
    const tabNavH = (): number => {
      const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spd-tabnav-h'))
      return Number.isFinite(v) ? v : 0
    }

    const unpin = () => {
      pinned = false
      col.classList.remove(STICKY_GALLERY_CLASS)
      document.documentElement.classList.remove(GALLERY_PINNED_CLASS)
      col.style.removeProperty('left')
      col.style.removeProperty('width')
      spacer.style.display = 'none'
      spacer.style.height = '0px'
    }

    // Everything that holds the gallery up: the option pickers, plus any box a
    // companion module has marked as part of configuring (GALLERY_HOLD_ATTR).
    const holders = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>(`.${OPTIONS_AREA_CLASS}, [${GALLERY_HOLD_ATTR}]`))

    const update = () => {
      const els = holders()
      if (els.length === 0) {
        if (pinned) unpin()
        return
      }
      if (ro) for (const el of els) if (!observed.has(el)) { ro.observe(el); observed.add(el) }
      // The gallery's natural place in the flow: its own box while unpinned,
      // the spacer holding that place while pinned.
      const flow = (pinned ? spacer : col).getBoundingClientRect()
      // Stacked = the holders sit below the gallery in the same column. On a
      // two-column desktop layout they sit beside it and nothing matches. Each
      // is judged on its own so one in a hidden tab panel (no box at all) or off
      // to the side cannot drag the release point around; the pin lasts until
      // the LAST stacked one has scrolled past.
      let holdBottom = -Infinity
      for (const el of els) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.top < flow.bottom - 1) continue
        if (r.left >= flow.right || r.right <= flow.left) continue
        if (r.bottom > holdBottom) holdBottom = r.bottom
      }
      if (holdBottom === -Infinity) {
        if (pinned) unpin()
        return
      }
      const h = headerH() + tabNavH()
      const stripH = compactH > 0 ? compactH : flow.width / 2 + 16
      // Pin while the gallery has scrolled up past where the compact strip sits,
      // and the last thing being configured hasn't yet.
      const shouldPin = flow.bottom <= h + stripH && holdBottom >= h + stripH
      if (shouldPin && !pinned) {
        pinned = true
        spacer.style.height = `${flow.height}px`
        spacer.style.display = 'block'
        col.classList.add(STICKY_GALLERY_CLASS)
        document.documentElement.classList.add(GALLERY_PINNED_CLASS)
      }
      if (pinned) {
        if (!shouldPin) {
          unpin()
          return
        }
        // Sized to the flow slot every tick, so an orientation change or a
        // resized window never leaves the strip the wrong width.
        col.style.left = `${flow.left}px`
        col.style.width = `${flow.width}px`
        compactH = col.getBoundingClientRect().height
      }
    }

    // The options area grows and shrinks as picks hide or reveal later options,
    // and an add-ons box opens right out as a shopper ticks one, which moves the
    // release point without any scroll happening.
    ro = new ResizeObserver(() => update())
    ro.observe(col)
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      ro?.disconnect()
      observed.clear()
      unpin()
    }
  }, [enabled])

  return { colRef, spacerRef }
}
