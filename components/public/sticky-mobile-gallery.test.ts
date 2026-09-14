import { describe, expect, it } from 'vitest'
import { stickyGalleryCss } from '@/modules/shop-variations/components/public/DetailSlotPartsClient'

describe('mobile sticky product gallery', () => {
  it('pins over the product tab strip rather than underneath it', () => {
    expect(stickyGalleryCss).toContain('top:var(--spd-header-h,96px)')
    expect(stickyGalleryCss).not.toContain('--spd-tabnav-h')
    expect(stickyGalleryCss).not.toContain('.svr-gallery-pinned .spd-tab-nav.sticky')
  })
})
