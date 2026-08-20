// How a product's own photographs and its promoted variations' ones make up one
// gallery.
//
// The owner arranges them together in the product editor's Images grid, and what
// gets stored is each promoted variation's `gallery_position`: its index in the
// FINISHED gallery, both sets counted together (see migration 016). This is the
// one function that turns that back into a list, and every place the gallery is
// drawn goes through it - the product page, the bare /details strip, the social
// preview - so none of them can quietly disagree about the order.
//
// Forgiving rather than exact. A variation that asked for slot 7 of a gallery
// that now holds four pictures lands at the end; deleting one of the product's
// own photographs shuffles the promoted ones up. Anything stricter would need the
// product's images and its variations to write to each other every time either
// changed, and the storefront would still have to cope with the drift.

export type GalleryPromoted<T> = {
  /** Index in the finished gallery, or null for "after the product's own". */
  galleryPosition: number | null
  item: T
}

/**
 * The product's own pictures with the promoted variations' folded in at the
 * slots they asked for.
 *
 * `promoted` must arrive in matrix order: that is the tiebreak when two
 * variations claim the same slot, and the order they take when none of them has
 * a slot at all - which is every product nobody has arranged, and where this
 * returns exactly what it always did, the product's own first.
 */
export function mergeGalleryItems<T>(own: T[], promoted: Array<GalleryPromoted<T>>): T[] {
  if (promoted.length === 0) return [...own]

  const placed = promoted
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (
      (a.entry.galleryPosition ?? Number.POSITIVE_INFINITY) - (b.entry.galleryPosition ?? Number.POSITIVE_INFINITY)
      || a.index - b.index
    ))

  const merged: T[] = []
  let next = 0
  for (const { entry } of placed) {
    const target = entry.galleryPosition ?? Number.POSITIVE_INFINITY
    while (next < own.length && merged.length < target) merged.push(own[next++]!)
    merged.push(entry.item)
  }
  while (next < own.length) merged.push(own[next++]!)
  return merged
}
