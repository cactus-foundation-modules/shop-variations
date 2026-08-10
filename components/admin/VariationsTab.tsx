'use client'

import { useState } from 'react'
import { TabStrip } from '@/components/admin/TabStrip'
import { VariationsBrowser } from '@/modules/shop-variations/components/admin/VariationsBrowser'
import { VariationsImportScreen } from '@/modules/shop-variations/components/admin/VariationsImportScreen'

// The whole of this module's admin, as the one Variations tab on Shop >
// Catalogue. The browser is the everyday view; the import and bulk tools sit
// behind a sub-tab rather than the sidebar link they used to have.
export function VariationsTab() {
  const [tab, setTab] = useState<'browse' | 'tools'>('browse')

  return (
    <div>
      <TabStrip
        style={{ marginBottom: '1.5rem' }}
        items={[
          { key: 'browse', label: 'All variations', active: tab === 'browse', onClick: () => setTab('browse') },
          { key: 'tools', label: 'Import & tools', active: tab === 'tools', onClick: () => setTab('tools') },
        ]}
      />
      {tab === 'browse' ? <VariationsBrowser /> : <VariationsImportScreen />}
    </div>
  )
}
