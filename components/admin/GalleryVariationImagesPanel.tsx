'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useProductEditorSave, useProductEditorSaveTick } from '@/modules/shop/components/admin/product-editor/context'
import { useRegisterGalleryExtras, type GalleryExtraItem } from '@/modules/shop/components/admin/product-editor/gallery-extras'

type Promoted = {
  variantId: string
  label: string
  url: string
  altText: string
  position: number | null
  // Which of the variation's up-front photos this tile is, and of how many, so
  // two shots of the same finish can be told apart by more than squinting.
  photoNumber?: number
  photoCount?: number
}

// One tile per photo, so the photo is part of the key: the same variation shows
// up as many times as it has photos up front.
const tileId = (p: Pick<Promoted, 'variantId' | 'url'>) => `${p.variantId}|${p.url}`

/**
 * The variations' photos this product shows off before the shopper has chosen
 * anything, as tiles in the product editor's own Images grid - one per photo, so
 * an owner can open on one shot of each finish and keep the second angles for
 * later rather than having each variation's photos stuck together.
 *
 * It used to be a pair of tick boxes underneath the grid saying which of two
 * piles went first. Nobody thinks about their gallery in piles: they think "the
 * oak one, then our two studio shots, then the walnut". So the promoted
 * variations now sit IN the grid, dragged about with the product's own
 * photographs, and what gets stored is each one's slot in the finished gallery.
 *
 * This component draws nothing but the note at the foot of the tab - the tiles
 * themselves are shop's, drawn from what we register here (see shop's
 * product-editor/gallery-extras.tsx). It registers with the editor's own Save
 * button too, so dragging a variation into place is saved by the same press as
 * the alt text three inches above it.
 */
export function GalleryVariationImagesPanel({ productId }: { productId: string }) {
  // null while the promoted variations are still on their way; nothing is drawn
  // in the grid until we know what is actually there, rather than tiles popping
  // in behind the product's own.
  const [saved, setSaved] = useState<Promoted[] | null>(null)
  const [value, setValue] = useState<Promoted[]>([])
  // Taken off the gallery but not yet saved (tile ids), so the × puts the tile
  // away at once and the Save button is what makes it stick.
  const [removed, setRemoved] = useState<string[]>([])

  // Which variations are promoted is decided on the Variations tab, and both
  // tabs stay mounted the whole time the product is open. So the set is read
  // again after every save, not only on mount - otherwise ticking "Image up
  // front" next door left this grid showing the old set until a page reload.
  const saveTick = useProductEditorSaveTick()

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`)
        if (!res.ok || !alive) return
        const data = await res.json() as { images?: Promoted[] }
        if (!alive) return
        const images = data.images ?? []
        setSaved(images)
        setValue(images)
        setRemoved([])
      } catch {
        // Unreachable server: leave the grid to the product's own pictures rather
        // than draw tiles we cannot vouch for.
      }
    })()
    return () => { alive = false }
  }, [productId, saveTick])

  const live = useMemo(() => value.filter((p) => !removed.includes(tileId(p))), [value, removed])

  const items: GalleryExtraItem[] = useMemo(() => live.map((p) => {
    const which = (p.photoCount ?? 1) > 1 ? `photo ${p.photoNumber ?? 1} of ${p.photoCount}` : null
    return {
      id: tileId(p),
      url: p.url,
      altText: p.altText,
      badge: 'Variation',
      caption: [p.label, which].filter(Boolean).join(', '),
      removeLabel: `Take this photo of ${p.label || 'this variation'} off the gallery. It stays on the variation.`,
      position: p.position,
    }
  }), [live])

  useRegisterGalleryExtras(items, {
    reorder: (order) => {
      const byId = new Map(order.map((o) => [o.id, o.position]))
      setValue((current) => current.map((p) => {
        const position = byId.get(tileId(p))
        return position === undefined ? p : { ...p, position }
      }))
    },
    setAltText: (id, altText) => {
      setValue((current) => current.map((p) => (tileId(p) === id ? { ...p, altText } : p)))
    },
    // Off the gallery, still on the variation - which is the whole distinction
    // worth making here. The picture, its description and the variation's own
    // Images list are all untouched; it just stops going up front, and once a
    // variation's last photo is off, so is its "Image up front".
    remove: (id) => setRemoved((current) => (current.includes(id) ? current : [...current, id])),
  })

  const save = useCallback(async () => {
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: live.map((p) => ({ variantId: p.variantId, url: p.url, position: p.position, altText: p.altText })),
        removed: value.filter((p) => removed.includes(tileId(p))).map((p) => ({ variantId: p.variantId, url: p.url })),
      }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The variation images did not save.')
    const data = await res.json().catch(() => ({})) as { images?: Promoted[] }
    const images = data.images ?? []
    setSaved(images)
    setValue(images)
    setRemoved([])
  }, [productId, live, value, removed])

  const dirty = saved !== null && (
    removed.length > 0
    || live.length !== saved.length
    || live.some((p, i) => {
      const was = saved[i]
      return !was || tileId(was) !== tileId(p) || was.position !== p.position || was.altText !== p.altText
    })
  )
  useProductEditorSave({ dirty, save })

  // The note is the only thing this component draws. Without it a "Variation"
  // tile is a picture with no visible way in or out, and the way in is on
  // another tab entirely.
  return (
    <p className="spe-section-blurb" style={{ marginTop: '-0.5rem' }}>
      Tiles marked <strong>Variation</strong> are variations&rsquo; photos shown off before the shopper has chosen
      anything, one tile per photo. Tick <em>Image up front</em> against a variation on the Variations tab to add
      one (and pick which of its photos go), drag each anywhere among the product&rsquo;s own pictures, and use its ×
      to take it back off - the picture stays on the variation either way.
    </p>
  )
}
