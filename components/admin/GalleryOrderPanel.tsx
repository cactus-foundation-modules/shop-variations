'use client'

import { useCallback, useEffect, useState } from 'react'
import { Section, Switch } from '@/modules/shop/components/admin/product-editor/fields'
import { useProductEditorSave } from '@/modules/shop/components/admin/product-editor/context'

type Flags = { baseImagesLast: boolean; cardImageFromVariation: boolean }

const OFF: Flags = { baseImagesLast: false, cardImageFromVariation: false }

/**
 * The tick boxes this module hangs on the product editor's Images tab: whether
 * the product's own photographs sit behind the variations promoted with "Image
 * up front", instead of leading the gallery as they normally do, and whether the
 * picture a grid shows for this product is a promoted variation's photo rather
 * than the product's own primary. Independent of each other on purpose - a
 * handsome variation is not always wanted in both places.
 *
 * It registers with the editor's own Save button rather than growing one of its
 * own, so a tick here is saved by the same press as an alt-text edit two inches
 * above it. Sitting inside the Images panel means the scope it registers under
 * is that tab, so the unsaved dot lands on "Images", which is where the admin
 * just clicked.
 */
export function GalleryOrderPanel({ productId }: { productId: string }) {
  // null while the current settings are still on their way; the boxes render
  // disabled rather than flicking from unticked to ticked once the answer lands.
  const [saved, setSaved] = useState<Flags | null>(null)
  const [value, setValue] = useState<Flags>(OFF)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`)
        if (!res.ok || !live) return
        const data = await res.json()
        if (!live) return
        const flags: Flags = {
          baseImagesLast: !!data.baseImagesLast,
          cardImageFromVariation: !!data.cardImageFromVariation,
        }
        setSaved(flags)
        setValue(flags)
      } catch {
        // Unreachable server: leave the boxes disabled rather than offer a setting
        // whose current state we cannot vouch for.
      }
    })()
    return () => { live = false }
  }, [productId])

  const save = useCallback(async () => {
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The image order did not save.')
    setSaved(value)
  }, [productId, value])

  const dirty = saved !== null && (
    saved.baseImagesLast !== value.baseImagesLast ||
    saved.cardImageFromVariation !== value.cardImageFromVariation
  )
  useProductEditorSave({ dirty, save })

  return (
    <Section
      title="Order on the product page"
      blurb="Variations ticked &ldquo;Image up front&rdquo; on the Variations tab also show in this product&rsquo;s gallery before a shopper has chosen anything."
    >
      <Switch
        checked={value.baseImagesLast}
        disabled={saved === null}
        onChange={(v) => setValue((f) => ({ ...f, baseImagesLast: v }))}
        label="Show these images after the variation images"
        hint="Off, the pictures above lead and the promoted variations follow. On, the variations lead and these sit behind them - handy where the product&rsquo;s own shots are line drawings or a bare cut-out and the variations are the handsome ones."
      />
      <Switch
        checked={value.cardImageFromVariation}
        disabled={saved === null}
        onChange={(v) => setValue((f) => ({ ...f, cardImageFromVariation: v }))}
        label="Use the variation image on category pages"
        hint="On, this product shows the first &ldquo;Image up front&rdquo; variation&rsquo;s photo wherever it appears in a grid - category pages, search results, related products. Off, it shows its own main picture, as it always has. The product&rsquo;s own pictures are still there either way, just further along the arrows."
      />
    </Section>
  )
}
