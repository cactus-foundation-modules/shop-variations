// Variations-owned CSV import/export, kept out of shop's import-engine. One row
// per variant: the parent (by slug), the option/value pairs that define it, and
// the per-variant fields. Re-importing updates in place (variants matched by
// their exact value-set), so the export round-trips.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { toCsvRow, parseCsv } from '@/modules/shop/lib/csv'
import { getProductBySlug, setProductMedia } from '@/modules/shop/lib/db/products'
import { reorganiseProductMedia } from '@/modules/shop/lib/media/product-media'
import { getEditorPayload, upsertVariantForCombination } from '@/modules/shop-variations/lib/variants-service'
import { getProductIdsWithVariations, getVariants, getVariantValueMap } from '@/modules/shop-variations/lib/db/variants'
import { getOptionsWithValues, createOption, createOptionValue } from '@/modules/shop-variations/lib/db/options'
import { resolveVariantFieldProviders } from '@/modules/shop-variations/lib/variant-field-providers'

export async function exportVariationsCsv(): Promise<string> {
  const ids = await getProductIdsWithVariations()
  const payloads = (await Promise.all(ids.map((id) => getEditorPayload(id)))).filter((p): p is NonNullable<typeof p> => !!p && p.variants.length > 0)
  const maxOptions = payloads.reduce((m, p) => Math.max(m, p.options.length), 1)

  // Extra per-variant fields other modules hang on the grid (e.g. attribute
  // values). Each provider's columns are gathered per product; the sheet header
  // is the union of every column label seen, in first-seen order, appended after
  // the module's own columns so an existing sheet's columns keep their place.
  const providers = await resolveVariantFieldProviders()
  const fieldColsByProduct = new Map<string, Array<{ key: string; label: string }>>()
  const fieldValuesByProduct = new Map<string, Record<string, Record<string, string>>>()
  const fieldHeaderOrder: string[] = []
  for (const p of payloads) {
    const childIds = p.variants.map((v) => v.childProductId)
    const cols: Array<{ key: string; label: string }> = []
    const values: Record<string, Record<string, string>> = {}
    for (const { provider } of providers) {
      const list = await provider.listColumns(p.product.id)
      if (list.length === 0) continue
      for (const c of list) {
        cols.push({ key: c.key, label: c.label })
        if (!fieldHeaderOrder.includes(c.label)) fieldHeaderOrder.push(c.label)
      }
      if (childIds.length > 0) {
        const got = await provider.getValues(p.product.id, childIds)
        for (const [child, rec] of Object.entries(got)) values[child] = { ...(values[child] ?? {}), ...rec }
      }
    }
    fieldColsByProduct.set(p.product.id, cols)
    fieldValuesByProduct.set(p.product.id, values)
  }

  const optionCols: string[] = []
  for (let i = 0; i < maxOptions; i++) optionCols.push(`Option ${i + 1}`, `Value ${i + 1}`)
  const lines = [toCsvRow(['Parent Slug', 'Parent Name', ...optionCols, 'Variant SKU', 'Price', 'Stock', 'Barcode', 'Weight', 'Image', ...fieldHeaderOrder])]

  for (const p of payloads) {
    const cols = fieldColsByProduct.get(p.product.id) ?? []
    const values = fieldValuesByProduct.get(p.product.id) ?? {}
    for (const v of p.variants) {
      const pairs: string[] = []
      for (const option of p.options) {
        const value = option.values.find((val) => v.optionValueIds.includes(val.id))
        pairs.push(option.name, value?.label ?? '')
      }
      while (pairs.length < maxOptions * 2) pairs.push('')
      const fieldCells = fieldHeaderOrder.map((label) => {
        const col = cols.find((c) => c.label === label)
        return col ? values[v.childProductId]?.[col.key] ?? '' : ''
      })
      lines.push(toCsvRow([
        p.product.slug, p.product.name, ...pairs,
        v.sku ?? '', String(v.price), v.stockCount != null ? String(v.stockCount) : '', v.barcode ?? '', v.weight != null ? String(v.weight) : '', v.imageUrl ?? '',
        ...fieldCells,
      ]))
    }
  }
  return lines.join('\n')
}

export type ImportResult = { created: number; updated: number; errors: Array<{ row: number; reason: string }> }

const num = (s: string | undefined): number | undefined => {
  if (s == null || s.trim() === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

// The Image column carries a media-library url. Only http(s) is accepted; a stray
// value (a filename, a note) is rejected rather than stored as a broken picture.
const isHttpUrl = (s: string): boolean => {
  try {
    const u = new URL(s)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function importVariationsCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text)
  const result: ImportResult = { created: 0, updated: 0, errors: [] }
  if (rows.length < 2) { result.errors.push({ row: 0, reason: 'No data rows found' }); return result }

  const providers = await resolveVariantFieldProviders()
  const header = (rows[0] ?? []).map((h) => h.trim())
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const slugCol = idx('Parent Slug')
  if (slugCol < 0) { result.errors.push({ row: 1, reason: 'Missing "Parent Slug" column' }); return result }
  const skuCol = idx('Variant SKU'), priceCol = idx('Price'), stockCol = idx('Stock'), barcodeCol = idx('Barcode'), weightCol = idx('Weight'), imageCol = idx('Image')

  const optionPairs: Array<{ nameCol: number; valueCol: number }> = []
  for (let i = 1; ; i++) {
    const nameCol = idx(`Option ${i}`), valueCol = idx(`Value ${i}`)
    if (nameCol < 0 || valueCol < 0) break
    optionPairs.push({ nameCol, valueCol })
  }

  // Group data rows by parent slug.
  const groups = new Map<string, Array<{ rowNum: number; cols: string[] }>>()
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]
    if (!cols) continue
    const slug = (cols[slugCol] ?? '').trim()
    if (!slug) { result.errors.push({ row: r + 1, reason: 'Missing parent slug' }); continue }
    const list = groups.get(slug) ?? []
    list.push({ rowNum: r + 1, cols })
    groups.set(slug, list)
  }

  for (const [slug, groupRows] of groups) {
    const parent = await getProductBySlug(slug)
    if (!parent || parent.catalogueHidden) {
      for (const gr of groupRows) result.errors.push({ row: gr.rowNum, reason: `Parent product not found: ${slug}` })
      continue
    }

    // Ensure every option + value named in this group's rows exists, building a
    // (optionName|valueLabel) -> value id map as we go.
    const valueIdByKey = new Map<string, string>()
    const optionByName = new Map<string, { id: string }>()
    for (const o of await getOptionsWithValues(parent.id)) {
      optionByName.set(o.name.toLowerCase(), { id: o.id })
      for (const v of o.values) valueIdByKey.set(`${o.name.toLowerCase()}|${v.label.toLowerCase()}`, v.id)
    }

    async function ensureValue(optName: string, valLabel: string): Promise<string> {
      const key = `${optName.toLowerCase()}|${valLabel.toLowerCase()}`
      const existing = valueIdByKey.get(key)
      if (existing) return existing
      let option = optionByName.get(optName.toLowerCase())
      if (!option) {
        const created = await createOption(parent!.id, optName, 'DROPDOWN', optionByName.size)
        option = { id: created.id }
        optionByName.set(optName.toLowerCase(), option)
      }
      const value = await createOptionValue(option.id, valLabel, null, valueIdByKey.size)
      valueIdByKey.set(key, value.id)
      return value.id
    }

    // Pre-load this parent's variants + value-set map once. upsertVariantForCombination
    // keeps this context current as it creates, so each row is O(1) DB work rather
    // than re-reading every sibling variant - a parent with hundreds of variants
    // used to be O(rows x variants) and could not finish inside the request budget.
    const upsertCtx = { parent, existing: await getVariants(parent.id), valueMap: await getVariantValueMap(parent.id) }

    // Each variant's current primary image, prefetched once for the whole parent.
    // The image write below re-files media through the storage provider (a network
    // round-trip per image), so doing it on every row every import - even when the
    // cell has not changed - is what pushed a large Pull past the request budget and
    // left the later rows (and their 3D files) unprocessed. With this we skip the
    // write entirely when the cell already matches what is stored.
    const currentImageByChild = new Map<string, string>()
    if (imageCol >= 0) {
      const childIds = upsertCtx.existing.map((v) => v.childProductId)
      if (childIds.length > 0) {
        const media = await prisma.$queryRaw<{ product_id: string; url: string }[]>`
          SELECT "product_id", "url" FROM "shp_product_media"
          WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE' AND "is_primary" = true
        `
        for (const m of media) currentImageByChild.set(m.product_id, m.url)
      }
    }

    for (const gr of groupRows) {
      try {
        const optionValueIds: string[] = []
        const labels: string[] = []
        for (const pair of optionPairs) {
          const optName = (gr.cols[pair.nameCol] ?? '').trim()
          const valLabel = (gr.cols[pair.valueCol] ?? '').trim()
          if (!optName || !valLabel) continue
          optionValueIds.push(await ensureValue(optName, valLabel))
          labels.push(valLabel)
        }
        if (optionValueIds.length === 0) { result.errors.push({ row: gr.rowNum, reason: 'No options on this row' }); continue }

        const { created, childProductId } = await upsertVariantForCombination(parent.id, optionValueIds, labels, {
          price: priceCol >= 0 ? num(gr.cols[priceCol]) : undefined,
          sku: skuCol >= 0 ? (gr.cols[skuCol]?.trim() || null) : undefined,
          barcode: barcodeCol >= 0 ? (gr.cols[barcodeCol]?.trim() || null) : undefined,
          stockCount: stockCol >= 0 ? (num(gr.cols[stockCol]) ?? null) : undefined,
          weight: weightCol >= 0 ? (num(gr.cols[weightCol]) ?? null) : undefined,
        }, upsertCtx)

        // Hand the whole row (keyed by header label) to each extra-field provider
        // so it can pick out its own columns and write them onto this variant.
        if (providers.length > 0) {
          const rowRecord: Record<string, string> = {}
          header.forEach((h, i) => { rowRecord[h] = (gr.cols[i] ?? '').trim() })
          for (const { provider } of providers) {
            await provider.applyImportedRow(parent.id, childProductId, rowRecord)
          }
        }

        // The variant's own image, stored as the hidden child product's primary
        // media - the same write the per-variant edit endpoint makes. An empty
        // cell clears it (the sheet is the truth); a non-url is flagged, not
        // stored. Only touched when the sheet actually carries an Image column, so
        // a legacy sheet from before this column existed leaves images alone.
        if (imageCol >= 0) {
          const raw = (gr.cols[imageCol] ?? '').trim()
          const current = currentImageByChild.get(childProductId) ?? ''
          if (raw === current) {
            // Unchanged - skip the media rewrite and its provider re-file entirely.
          } else if (raw === '') {
            await setProductMedia(childProductId, [])
          } else if (isHttpUrl(raw)) {
            await setProductMedia(childProductId, [{ type: 'IMAGE', url: raw, isPrimary: true }])
            // File it in the parent's media-library folder, as the edit endpoint does.
            await reorganiseProductMedia(childProductId, { folderProductId: parent.id })
            currentImageByChild.set(childProductId, raw)
          } else {
            result.errors.push({ row: gr.rowNum, reason: `Invalid image URL: ${raw}` })
          }
        }

        if (created) result.created += 1
        else result.updated += 1
      } catch (err) {
        result.errors.push({ row: gr.rowNum, reason: err instanceof Error ? err.message : 'Row failed' })
      }
    }
  }

  return result
}
