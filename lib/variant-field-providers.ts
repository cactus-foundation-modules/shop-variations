import type { ComponentType } from 'react'
import { prisma } from '@/lib/db/prisma'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { moduleExtensionPointComponents } from '@/lib/modules/extension-points'

// A generic, attribute-agnostic way for another module to hang extra per-variant
// fields on this module. Unlike `shop-variations.variant-columns` - which is a
// single, statically-declared column - a field provider returns a set of columns
// that depends on the product being edited, so one module can contribute a
// different number of columns per product (e.g. one per attribute a product uses
// for its variations).
//
// The same provider drives three places, so the admin grid, the CSV export and
// the CSV import all agree without this module knowing a thing about what the
// columns mean:
//   - the Variations tab renders `Cell` once per (variant, column);
//   - `exportVariationsCsv` adds each column to the sheet and fills it via `getValues`;
//   - `importVariationsCsv` hands every row back through `applyImportedRow`.
// Because the columns round-trip through the CSV, the Google Sheet sync carries
// them for free - it round-trips whatever the CSV emits.

export type VariantFieldColumn = {
  /** Stable-per-product column key the provider recognises (opaque to us). */
  key: string
  /** Column heading. Also the CSV column header, so it must be stable per key. */
  label: string
  /** Where the column sits among the grid's own. Unordered columns go last. */
  order?: number
}

export type VariantFieldCellProps = {
  productId: string
  variantId: string
  childProductId: string
  /** Which of the provider's columns this cell renders. Always set for a field-provider column. */
  columnKey?: string
  label: string
}

export type VariantFieldProvider = {
  /** Columns this provider contributes for the given product. Empty = none. */
  listColumns(productId: string): Promise<VariantFieldColumn[]>
  /** Per child product, the value string for each of its column keys (for CSV export). */
  getValues(productId: string, childProductIds: string[]): Promise<Record<string, Record<string, string>>>
  /** Apply one CSV row's provider columns to a variant's child product. `row` is keyed by header label. */
  applyImportedRow(productId: string, childProductId: string, row: Record<string, string>): Promise<void>
  /** The admin grid cell. A client component that renders one column's control and saves itself. */
  Cell: ComponentType<VariantFieldCellProps>
}

const POINT = 'shop-variations.variant-field-provider'

type ManifestEntry = { point: string; id: string; permission?: string }

/**
 * Provider objects contributed by active modules through the
 * `shop-variations.variant-field-provider` point. Resolved from the stored
 * manifests, like the variant-columns resolver, because only a server context
 * can read them. Pass a `user` on the admin path to gate columns by permission;
 * the CSV path runs behind its own route guard and needs no per-provider gate.
 */
export async function resolveVariantFieldProviders(
  user?: Awaited<ReturnType<typeof getSessionFromCookie>>,
): Promise<Array<{ id: string; provider: VariantFieldProvider }>> {
  const modules = await prisma.module.findMany({
    where: { status: { in: ['active', 'update_available'] } },
    select: { manifest: true },
  })
  const components = moduleExtensionPointComponents[POINT] ?? {}
  const out: Array<{ id: string; provider: VariantFieldProvider }> = []
  const seen = new Set<string>()
  for (const mod of modules) {
    const manifest = mod.manifest as { extensionPoints?: ManifestEntry[] } | null
    for (const entry of manifest?.extensionPoints ?? []) {
      if (entry.point !== POINT || seen.has(entry.id)) continue
      if (user && entry.permission && !(await hasPermission(user, entry.permission))) continue
      const provider = components[entry.id] as VariantFieldProvider | undefined
      if (provider) {
        out.push({ id: entry.id, provider })
        seen.add(entry.id)
      }
    }
  }
  return out
}
