import { headers } from 'next/headers'
import Link from 'next/link'
import { getVariationsSummary } from '@/modules/shop-variations/lib/variants-service'

// Inline summary hung under the shop product editor via the
// shop.product-editor-sections slot. Compact overview + a link into the
// deep-dive editor. Server component - reads the summary directly.
export async function ProductVariationsSection({ productId }: { productId: string }) {
  const adminPath = (await headers()).get('x-cactus-admin-path') ?? ''
  const summary = await getVariationsSummary(productId)
  const editorHref = `/${adminPath}/m/shop-variations/products/${productId}`
  const hasVariations = summary.optionCount > 0 || summary.variantCount > 0 || summary.addonCount > 0

  const chip = {
    display: 'inline-block',
    fontSize: '0.8125rem',
    padding: '0.125rem 0.5rem',
    borderRadius: 999,
    background: 'var(--color-bg-subtle)',
    border: '1px solid var(--color-border)',
  } as const

  return (
    <section style={{ marginTop: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 12, padding: '1rem 1.25rem', background: 'var(--color-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '0.9375rem', margin: 0 }}>Variations &amp; personalisation</h3>
        <Link href={editorHref} className="btn btn-secondary btn-sm">
          {hasVariations ? 'Manage variations' : 'Add options'}
        </Link>
      </div>

      {hasVariations ? (
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
          {summary.optionNames.length > 0 && (
            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {summary.optionNames.map((name) => <span key={name} style={chip}>{name}</span>)}
            </div>
          )}
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            {summary.variantCount} variant{summary.variantCount === 1 ? '' : 's'}
            {summary.enabledVariantCount !== summary.variantCount && ` (${summary.enabledVariantCount} enabled)`}
            {summary.aggregateStock != null && ` · ${summary.aggregateStock} in stock`}
            {summary.addonCount > 0 && ` · ${summary.addonCount} personalisation field${summary.addonCount === 1 ? '' : 's'}`}
          </p>
        </div>
      ) : (
        <p style={{ marginTop: '0.5rem', marginBottom: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          Give this product size/colour options or personalisation fields (engraving, uploads, and more).
        </p>
      )}
    </section>
  )
}
