import type { ComponentType } from 'react'
import type { ShopGalleryExtra, ShopGalleryExtraThumbsProps } from '@/modules/shop/lib/gallery-media'

// A contributed gallery strip (see shop's lib/gallery-media.ts), typed to take
// `previewProductIds` whether or not the shop it is built against has that field
// yet. Spelled out here deliberately: the build gate composes this module against
// the shop version core currently pins, which may predate it - and an install
// that updates the two in either order must still build. Same optional prop, not
// a second one; a provider that has never heard of it simply ignores it.
export type PreviewAwareThumbs = ComponentType<ShopGalleryExtraThumbsProps & { previewProductIds?: string[] }>

export function previewAwareThumbs(extra: ShopGalleryExtra): PreviewAwareThumbs {
  return extra.Thumbs as PreviewAwareThumbs
}
