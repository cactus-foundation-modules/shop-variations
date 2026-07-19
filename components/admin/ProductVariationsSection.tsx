import { getProductById } from '@/modules/shop/lib/db'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { prisma } from '@/lib/db/prisma'
import { INSTALLED_MODULE_WHERE } from '@/lib/modules/live-status'
import { moduleExtensionPointComponents } from '@/lib/modules/extension-points'
import { VariationsPanel, type VariantColumn } from '@/modules/shop-variations/components/admin/VariationsPanel'
import { resolveVariantFieldProviders } from '@/modules/shop-variations/lib/variant-field-providers'

// The Variations tab on the shop product editor, contributed through the
// shop.product-editor-sections point. Server component: it only decides whether
// this product can carry variations at all, then hands off to the client panel,
// which registers its own edits with the editor's single Save button.

type ExtensionPointEntry = {
  point: string
  id: string
  permission?: string
  /** Column heading. Falls back to the entry id if a module has not declared one. */
  label?: string
  /** Where the column sits among the table's own. Unordered columns go last. */
  order?: number
}

/**
 * Columns other modules hang on the variants table through the
 * `shop-variations.variant-columns` point, resolved here because only a server
 * component can read the manifests and check permissions.
 *
 * This module knows nothing about what any of them are for. A contributed column
 * gets the ids of the variant and of its hidden child product, and owns everything
 * after that: its own storage, its own saving, its own idea of what a cell is. The
 * panel just leaves a gap in each row.
 *
 * A contributed component MUST be a client component. The panel is one, and it
 * renders these once per variant from a list it fetches in the browser - so what
 * crosses over from here is the component itself, and only a client component
 * survives that trip.
 */
async function resolveVariantColumns(user: Awaited<ReturnType<typeof getSessionFromCookie>>): Promise<VariantColumn[]> {
  if (!user) return []
  const modules = await prisma.module.findMany({
    where: { ...INSTALLED_MODULE_WHERE },
    select: { manifest: true },
  })
  const entries: ExtensionPointEntry[] = []
  for (const mod of modules) {
    const manifest = mod.manifest as { extensionPoints?: ExtensionPointEntry[] } | null
    if (!manifest?.extensionPoints) continue
    for (const entry of manifest.extensionPoints) {
      if (entry.point !== 'shop-variations.variant-columns') continue
      if (!entry.permission || (await hasPermission(user, entry.permission))) entries.push(entry)
    }
  }

  const components = moduleExtensionPointComponents['shop-variations.variant-columns'] ?? {}
  return entries
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .flatMap((entry) => {
      const Cell = components[entry.id]
      return Cell ? [{ id: entry.id, label: entry.label ?? entry.id, Cell }] : []
    })
}

/**
 * Dynamic columns from field providers. Unlike the static variant-columns above,
 * these depend on the product - a provider can return one column per attribute a
 * product uses for its variations - so this needs the product id the static
 * resolver does not. Each column reuses its provider's one Cell, told which
 * column it is through `columnKey`.
 */
async function resolveFieldColumns(
  user: Awaited<ReturnType<typeof getSessionFromCookie>>,
  productId: string,
): Promise<VariantColumn[]> {
  if (!user) return []
  const providers = await resolveVariantFieldProviders(user)
  const columns: VariantColumn[] = []
  for (const { id, provider } of providers) {
    const list = await provider.listColumns(productId)
    for (const c of list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999))) {
      columns.push({ id: `${id}:${c.key}`, label: c.label, columnKey: c.key, Cell: provider.Cell })
    }
  }
  return columns
}

export async function ProductVariationsSection({ productId }: { productId: string }) {
  const product = await getProductById(productId)

  // Variant children are themselves products, but a variant of a variant is not a
  // thing. The service refuses it, so do not offer it.
  if (!product || product.catalogueHidden) return null

  const user = await getSessionFromCookie()
  const [staticColumns, fieldColumns] = await Promise.all([
    resolveVariantColumns(user),
    resolveFieldColumns(user, productId),
  ])

  return <VariationsPanel productId={productId} columns={[...staticColumns, ...fieldColumns]} />
}
