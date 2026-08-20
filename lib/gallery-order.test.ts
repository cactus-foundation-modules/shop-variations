import { describe, it, expect } from 'vitest'
import { mergeGalleryItems, galleryLeadsWithPromoted, type GalleryPromoted } from '@/modules/shop-variations/lib/gallery-order'

const at = (galleryPosition: number | null, item: string): GalleryPromoted<string> => ({ galleryPosition, item })

describe('mergeGalleryItems', () => {
  it('leaves a product with no promoted variations exactly as it is', () => {
    expect(mergeGalleryItems(['a', 'b'], [])).toEqual(['a', 'b'])
  })

  it('puts unplaced variations after the product own pictures - the old default', () => {
    expect(mergeGalleryItems(['a', 'b'], [at(null, 'x'), at(null, 'y')])).toEqual(['a', 'b', 'x', 'y'])
  })

  it('puts a variation claiming slot 0 in front of everything', () => {
    expect(mergeGalleryItems(['a', 'b'], [at(0, 'x')])).toEqual(['x', 'a', 'b'])
  })

  it('interleaves - which is the whole point of the arrangement', () => {
    expect(mergeGalleryItems(['a', 'b', 'c'], [at(1, 'x'), at(4, 'y')])).toEqual(['a', 'x', 'b', 'c', 'y'])
  })

  it('round-trips an arrangement: every index comes back where it was put', () => {
    const arranged = ['a', 'x', 'b', 'y', 'c']
    const own = ['a', 'b', 'c']
    const promoted = [at(arranged.indexOf('x'), 'x'), at(arranged.indexOf('y'), 'y')]
    expect(mergeGalleryItems(own, promoted)).toEqual(arranged)
  })

  it('shuffles up rather than stranding when a product picture is deleted', () => {
    expect(mergeGalleryItems(['a'], [at(3, 'x')])).toEqual(['a', 'x'])
  })

  it('keeps matrix order when two variations claim the same slot', () => {
    expect(mergeGalleryItems(['a'], [at(0, 'x'), at(0, 'y')])).toEqual(['x', 'y', 'a'])
  })

  it('places every variation even where there are no product pictures at all', () => {
    expect(mergeGalleryItems([], [at(2, 'x'), at(null, 'y')])).toEqual(['x', 'y'])
  })
})

describe('galleryLeadsWithPromoted', () => {
  it('is true only when a variation claimed the very first slot', () => {
    expect(galleryLeadsWithPromoted([0, 3])).toBe(true)
    expect(galleryLeadsWithPromoted([1, 2])).toBe(false)
    expect(galleryLeadsWithPromoted([null])).toBe(false)
    expect(galleryLeadsWithPromoted([])).toBe(false)
  })
})
