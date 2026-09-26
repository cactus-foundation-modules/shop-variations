import { describe, it, expect } from 'vitest'
import { buildStorefrontLinks } from '@/modules/shop-variations/lib/storefront-link-provider'

// A variation's storefront address for the admin order screen: its parent
// listing with the combination spelt exactly as the sitemap spells it.
const options = [
  { product_id: 'p', option_id: 'w', option_name: 'Width' },
  { product_id: 'p', option_id: 'f', option_name: 'Finish' },
  { product_id: 'p', option_id: 'l', option_name: 'Leg Finish' },
]
const values = [
  { option_id: 'w', value_id: 'w160', value_slug: '160cm' },
  { option_id: 'f', value_id: 'fw', value_slug: 'walnut' },
  { option_id: 'l', value_id: 'lw', value_slug: 'white' },
]

describe('buildStorefrontLinks', () => {
  it('answers a child with its parent page and the options in display order', () => {
    const links = buildStorefrontLinks(
      [{ child_id: 'c', parent_id: 'p', parent_slug: 'desk', value_ids: ['lw', 'w160', 'fw'] }],
      options,
      values,
    )
    expect(links).toEqual({ c: { slug: 'desk', query: 'width=160cm&finish=walnut&leg-finish=white' } })
  })

  it('leaves a child unanswered when the combination has no address of its own', () => {
    const links = buildStorefrontLinks(
      [{ child_id: 'c', parent_id: 'p', parent_slug: 'desk', value_ids: ['w160', 'fw'] }],
      options,
      values,
    )
    expect(links).toEqual({})
  })
})
