'use client'

import { useCallback, useEffect, useState } from 'react'
import { Section, Switch } from '@/modules/shop/components/admin/product-editor/fields'
import { useProductEditorSave } from '@/modules/shop/components/admin/product-editor/context'

/**
 * The one tick box this module hangs on the product editor's Images tab: whether
 * the product's own photographs sit behind the variations promoted with "Image
 * up front", instead of leading the gallery as they normally do.
 *
 * It registers with the editor's own Save button rather than growing one of its
 * own, so a tick here is saved by the same press as an alt-text edit two inches
 * above it. Sitting inside the Images panel means the scope it registers under
 * is that tab, so the unsaved dot lands on "Images", which is where the admin
 * just clicked.
 */
export function GalleryOrderPanel({ productId }: { productId: string }) {
  // null while the current setting is still on its way; the box renders disabled
  // rather than flicking from unticked to ticked once the answer lands.
  const [saved, setSaved] = useState<boolean | null>(null)
  const [value, setValue] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`)
        if (!res.ok || !live) return
        const data = await res.json()
        if (!live) return
        setSaved(!!data.baseImagesLast)
        setValue(!!data.baseImagesLast)
      } catch {
        // Unreachable server: leave the box disabled rather than offer a setting
        // whose current state we cannot vouch for.
      }
    })()
    return () => { live = false }
  }, [productId])

  const save = useCallback(async () => {
    const res = await fetch(`/api/m/shop-variations/admin/products/${productId}/gallery`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseImagesLast: value }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'The image order did not save.')
    setSaved(value)
  }, [productId, value])

  useProductEditorSave({ dirty: saved !== null && saved !== value, save })

  return (
    <Section
      title="Order on the product page"
      blurb="Variations ticked &ldquo;Image up front&rdquo; on the Variations tab also show in this product&rsquo;s gallery before a shopper has chosen anything."
    >
      <Switch
        checked={value}
        disabled={saved === null}
        onChange={setValue}
        label="Show these images after the variation images"
        hint="Off, the pictures above lead and the promoted variations follow. On, the variations lead and these sit behind them - handy where the product&rsquo;s own shots are line drawings or a bare cut-out and the variations are the handsome ones."
      />
    </Section>
  )
}
