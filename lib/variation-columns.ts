import type { VariantFieldColumn } from '@/modules/shop-variations/lib/variant-field-providers'

// Merging the contributed columns of the cross-product Variations browser.
//
// A field provider keys its columns per product, because that is what it needs
// to store a value: the attributes module keys each column by the ASSIGNMENT, so
// a product can put one attribute up twice under two headings ("Main finish",
// "Edge finish") and keep the two apart. That is right for a single product's
// Variations tab, and wrong for the browser, which looks at the whole catalogue
// at once: fifty products using "Overall Height" contribute fifty distinct keys
// under one heading, which showed up as fifty identical columns in the grid and
// fifty identical "Without Overall Height" entries in the filter dropdown.
//
// So the browser merges by heading: one column per (provider, heading), holding
// every provider key that feeds it. Nothing is lost, because within one product
// headings are unique - the attributes editor refuses to save two helpings of an
// attribute under one name, for exactly this reason - so no single product ever
// contributes two keys to the same merged column.
//
// Kept apart from variations-list.ts, and free of any database access, so the
// merge can be tested on its own.

/** One provider's columns for one product, as the provider returned them. */
export type ColumnContribution = {
  /** The extension-point id of the provider (its half of a column id). */
  providerId: string
  columns: VariantFieldColumn[]
}

/** A merged column plus the per-product provider keys that feed it. */
export type MergedVariationColumn = {
  id: string
  label: string
  kind: 'text' | 'file'
  /** `<providerId>:<key>` for every provider key merged into this column. */
  members: string[]
}

/**
 * Column id for one provider key, as `collectValues` keys its values. Never
 * leaves the server: the browser only ever sees a merged id.
 */
export function memberColumnId(providerId: string, key: string): string {
  return `${providerId}:${key}`
}

/**
 * Merge every contribution into one column per (provider, heading), in first-seen
 * order so a provider's columns stay together and each provider's own `order`
 * still decides the run within it. Headings are matched case- and space-
 * insensitively; the first spelling seen is the one displayed.
 *
 * The merged id uses `#` where a member id uses `:`, so a merged id can never
 * collide with the member id of some other column of the same provider.
 */
export function mergeContributedColumns(contributions: ColumnContribution[]): MergedVariationColumn[] {
  const merged: MergedVariationColumn[] = []
  const byMergedId = new Map<string, MergedVariationColumn>()
  const seenMember = new Set<string>()

  for (const { providerId, columns } of contributions) {
    const ordered = columns.slice().sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    for (const col of ordered) {
      const memberId = memberColumnId(providerId, col.key)
      if (seenMember.has(memberId)) continue
      seenMember.add(memberId)

      const label = col.label.trim()
      const mergedId = `${providerId}#${label.toLowerCase()}`
      const existing = byMergedId.get(mergedId)
      if (existing) {
        existing.members.push(memberId)
        // A column is a file column if any provider key feeding it says so - the
        // "lost" filter can then be offered, and a text member simply yields no
        // urls to check.
        if (col.kind === 'file') existing.kind = 'file'
        continue
      }
      const entry: MergedVariationColumn = { id: mergedId, label, kind: col.kind ?? 'text', members: [memberId] }
      byMergedId.set(mergedId, entry)
      merged.push(entry)
    }
  }

  return merged
}

/**
 * One child product's contributed values, re-keyed from provider keys to merged
 * column ids. A single product only ever feeds one member key per merged column,
 * so the first non-empty member is that product's value for it.
 */
export function mergeValues(
  raw: Record<string, string> | undefined,
  columns: MergedVariationColumn[],
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw) return out
  for (const col of columns) {
    for (const memberId of col.members) {
      const v = raw[memberId]
      if (v && v.trim() !== '') {
        out[col.id] = v
        break
      }
    }
  }
  return out
}
