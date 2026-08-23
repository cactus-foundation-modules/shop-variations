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
}

/**
 * The variations this product shows off before the shopper has chosen anything,
 * as tiles in the product editor's own Images grid.
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
  // Taken off the gallery but not yet saved, so the × puts the tile away at once
  // and the Save button is what makes it stick.
  const [demoted, setDemoted] = useState<string[]>([])

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
        setDemoted([])
      } catch {
        // Unreachable server: leave the grid to the product's own pictures rather
        // than draw tiles we cannot vouch for.
      }
    })()
    return () => { alive = false }
  }, [productId, saveTick])

  const live = useMemo(() => value.filter((p) => !demoted.includes(p.variantId)), [value, demoted])

  const items: GalleryExtraItem[] = useMemo(() => live.map((p) => ({
    id: p.variantId,
    url: p.url,
    altText: p.altText,
    badge: 'Variation',
    caption: p.label,
    removeLabel: `Take ${p.label || 'this variation'} off the gallery. Its picture stays on the variation.`,
    position: p.position,
  })), [live])

  useRegisterGalleryExtras(items, {
    reorder: (order) => {
      const byId = new Map(order.map((o) => [o.id, o.position]))
      setValue((current) => current.map((p) => (byId.has(p.variantId) ? { ...p, position: byId.get(p.variantId)! } : p)))
    },
    setAltText: (id, altText) => {
      setValue((current) => current.map((p) => (p.variantId === id ? { ...p, altText } : p)))
    },
    // Off the gallery, still on the variation - which is the whole distinction
    // worth making here. The picture, its description and the variation's own
    // Images list are all untouched; only "Image up front" goes off.
    remove: (id) => setDemoted((current) => (current.includes(id) ? current : [...current, id])),
  })

  const save = useCallback(async () => {
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        images: live.map((p) => ({ variantId: p.variantId, position: p.position, altText: p.altText })),
        demoted,
      }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The variation images did not save.')
    const data = await res.json().catch(() => ({})) as { images?: Promoted[] }
    const images = data.images ?? []
    setSaved(images)
    setValue(images)
    setDemoted([])
  }, [productId, live, demoted])

  const dirty = saved !== null && (
    demoted.length > 0
    || live.length !== saved.length
    || live.some((p, i) => {
      const was = saved[i]
      return !was || was.variantId !== p.variantId || was.position !== p.position || was.altText !== p.altText
    })
  )
  useProductEditorSave({ dirty, save })

  // The note is the only thing this component draws. Without it a "Variation"
  // tile is a picture with no visible way in or out, and the way in is on
  // another tab entirely.
  return (
    <p className="spe-section-blurb" style={{ marginTop: '-0.5rem' }}>
      Tiles marked <strong>Variation</strong> are variations shown off before the shopper has chosen anything.
      Tick <em>Image up front</em> against a variation on the Variations tab to add one, drag it anywhere among the
      product&rsquo;s own pictures, and use its × to take it back off - the picture stays on the variation either way.
    </p>
  )
}
