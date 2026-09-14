import { describe, expect, it } from 'vitest'
import { stickyGalleryCss } from '@/modules/shop-variations/components/public/DetailSlotPartsClient'

describe('mobile sticky product gallery', () => {
  it('pins over the product tab strip rather than underneath it', () => {
    expect(stickyGalleryCss).toContain('top:var(--spd-header-h,96px)')
    expect(stickyGalleryCss).not.toContain('--spd-tabnav-h')
    expect(stickyGalleryCss).not.toContain('.svr-gallery-pinned .spd-tab-nav.sticky')
  })

  it('lets an immersive contributed stage take the pinned strip full width on phones', () => {
    expect(stickyGalleryCss).toContain(`.spd-stage-col.svr-mstick.spd-stage-col--mobile-immersive{grid-template-columns:1fr}`)
    expect(stickyGalleryCss).toContain(`.spd-stage-col.svr-mstick.spd-stage-col--mobile-immersive .spd-thumbs-wrap{display:none}`)
    expect(stickyGalleryCss).toContain(`.spd-stage-col.svr-mstick.spd-stage-col--mobile-immersive .mcf-stage-caption{display:none}`)
  })
})
