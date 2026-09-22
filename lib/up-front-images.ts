// Which of a promoted variation's photographs go on the parent's gallery before
// the shopper has chosen anything - the owner's pick from the variation's
// expanded row on the Variations tab (migration 018).
//
// One rule, read everywhere the gallery is drawn: the chosen photos in the
// variation's own order, or its first photo where nothing chosen is still on it.
// That fallback is what every product showed before there was a choice to make,
// and it is also what stops a stale pick (a photo since removed from the
// variation) from emptying the variation's slot on the gallery.

/** Indexes into `imageUrls` of the photos that go up front. Empty only when the variation has no photo at all. */
export function upFrontImageIndexes(imageUrls: readonly string[], chosenUrls: readonly string[] | null | undefined): number[] {
  if (imageUrls.length === 0) return []
  const chosen = new Set(chosenUrls ?? [])
  const picked = imageUrls.flatMap((url, index) => (chosen.has(url) ? [index] : []))
  return picked.length > 0 ? picked : [0]
}

/**
 * The storefront payload's own form of the same answer: `indexes` is what the
 * server sent (absent means the first photo), checked against the photos the
 * variation actually carries so a payload out of step with its pictures still
 * draws something rather than a hole.
 */
export function upFrontIndexesFromPayload(imageCount: number, indexes: readonly number[] | undefined): number[] {
  if (imageCount === 0) return []
  const valid = (indexes ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < imageCount)
  return valid.length > 0 ? [...new Set(valid)] : [0]
}

/**
 * What the payload carries for a variation: the indexes, or undefined where they
 * say nothing the fallback does not - which is every variation nobody has picked
 * for, so a shopper's copy of an ordinary range carries none of this.
 */
export function payloadUpFrontIndexes(imageUrls: readonly string[], chosenUrls: readonly string[] | null | undefined): number[] | undefined {
  const indexes = upFrontImageIndexes(imageUrls, chosenUrls)
  return indexes.length === 1 && indexes[0] === 0 ? undefined : indexes
}
