import { describe, it, expect } from 'vitest'
import { payloadUpFrontIndexes, photoPositionsFor, upFrontImageIndexes, upFrontIndexesFromPayload } from '@/modules/shop-variations/lib/up-front-images'
import { blocksAsPositionedItems, mergeGalleryBlocks, mergeGalleryItems, promotedPhotosAsPositionedItems } from '@/modules/shop-variations/lib/gallery-order'

const urls = ['a.jpg', 'b.jpg', 'c.jpg']

describe('upFrontImageIndexes', () => {
  it('is the first photo when nothing has been picked', () => {
    expect(upFrontImageIndexes(urls, null)).toEqual([0])
    expect(upFrontImageIndexes(urls, [])).toEqual([0])
  })

  it('is the picked photos, in the variation\'s own order', () => {
    expect(upFrontImageIndexes(urls, ['c.jpg', 'b.jpg'])).toEqual([1, 2])
  })

  it('falls back to the first photo when every pick has since left the variation', () => {
    expect(upFrontImageIndexes(urls, ['gone.jpg'])).toEqual([0])
  })

  it('is nothing for a variation with no photo', () => {
    expect(upFrontImageIndexes([], ['a.jpg'])).toEqual([])
  })
})

describe('payloadUpFrontIndexes', () => {
  it('says nothing where the answer is the first photo anyway', () => {
    expect(payloadUpFrontIndexes(urls, null)).toBeUndefined()
    expect(payloadUpFrontIndexes(urls, ['a.jpg'])).toBeUndefined()
  })

  it('carries a real pick', () => {
    expect(payloadUpFrontIndexes(urls, ['b.jpg'])).toEqual([1])
  })
})

describe('upFrontIndexesFromPayload', () => {
  it('reads an absent list as the first photo', () => {
    expect(upFrontIndexesFromPayload(3, undefined)).toEqual([0])
  })

  it('drops indexes past the photos the variation carries', () => {
    expect(upFrontIndexesFromPayload(2, [1, 5])).toEqual([1])
    expect(upFrontIndexesFromPayload(2, [5])).toEqual([0])
  })
})

describe('mergeGalleryBlocks', () => {
  it('keeps a block together at its slot, counting blocks as one tile', () => {
    expect(mergeGalleryBlocks(['p1', 'p2', 'p3'], [
      { galleryPosition: 1, item: ['oak1', 'oak2'] },
      { galleryPosition: 3, item: ['walnut'] },
    ])).toEqual(['p1', 'oak1', 'oak2', 'p2', 'walnut', 'p3'])
  })

  it('ignores an empty block', () => {
    expect(mergeGalleryBlocks(['p1'], [{ galleryPosition: 0, item: [] }])).toEqual(['p1'])
  })
})

describe('blocksAsPositionedItems', () => {
  it('gives a picture-counting merge the same answer as the block merge', () => {
    const own = ['p1', 'p2', 'p3', 'p4']
    const blocks = [
      { galleryPosition: 3, item: ['walnut'] },
      { galleryPosition: 1, item: ['oak1', 'oak2', 'oak3'] },
      { galleryPosition: null, item: ['ash1', 'ash2'] },
      { galleryPosition: 0, item: [] as string[] },
    ]
    expect(mergeGalleryItems(own, blocksAsPositionedItems(blocks))).toEqual(mergeGalleryBlocks(own, blocks))
    expect(mergeGalleryBlocks(own, blocks)).toEqual(['p1', 'oak1', 'oak2', 'oak3', 'p2', 'walnut', 'p3', 'p4', 'ash1', 'ash2'])
  })
})

describe('photoPositionsFor', () => {
  it('is undefined for a variation never arranged photo by photo', () => {
    expect(photoPositionsFor(['a.jpg'], ['a.jpg'], null)).toBeUndefined()
  })

  it('looks each slot up by URL, whatever order the pick was stored in', () => {
    expect(photoPositionsFor(['a.jpg', 'c.jpg'], ['c.jpg', 'a.jpg'], [3, 0])).toEqual([0, 3])
  })

  it('leaves a photo with no slot of its own for after the rest', () => {
    expect(photoPositionsFor(['a.jpg', 'b.jpg'], ['a.jpg', 'b.jpg'], [2, null])).toEqual([2, null])
    expect(photoPositionsFor(['a.jpg', 'b.jpg'], ['a.jpg'], [2])).toEqual([2, null])
  })
})

describe('promotedPhotosAsPositionedItems', () => {
  it('interleaves two variations photo by photo', () => {
    const entries = [
      { galleryPosition: 0, item: ['oak1', 'oak2'], photoPositions: [0, 2] },
      { galleryPosition: 1, item: ['walnut1', 'walnut2'], photoPositions: [1, 3] },
    ]
    expect(mergeGalleryItems([], promotedPhotosAsPositionedItems(entries))).toEqual(['oak1', 'walnut1', 'oak2', 'walnut2'])
  })

  it('reads a variation with no per-photo slots exactly as the block merge does', () => {
    const own = ['p1', 'p2', 'p3', 'p4']
    const blocks = [
      { galleryPosition: 3, item: ['walnut'] },
      { galleryPosition: 1, item: ['oak1', 'oak2', 'oak3'] },
      { galleryPosition: null, item: ['ash1', 'ash2'] },
    ]
    expect(mergeGalleryItems(own, promotedPhotosAsPositionedItems(blocks))).toEqual(mergeGalleryBlocks(own, blocks))
  })

  it('treats slots out of step with the photos as no slots at all', () => {
    const entries = [{ galleryPosition: 0, item: ['oak1', 'oak2'], photoPositions: [5] }]
    expect(mergeGalleryItems(['p1'], promotedPhotosAsPositionedItems(entries))).toEqual(['oak1', 'oak2', 'p1'])
  })

  it('places photos among the product\'s own by picture count', () => {
    const entries = [
      { galleryPosition: null, item: ['oak1', 'oak2'], photoPositions: [0, 3] },
      { galleryPosition: null, item: ['walnut1'], photoPositions: [2] },
    ]
    expect(mergeGalleryItems(['p1', 'p2'], promotedPhotosAsPositionedItems(entries))).toEqual(['oak1', 'p1', 'walnut1', 'oak2', 'p2'])
  })
})
