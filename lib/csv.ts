// Variations-owned CSV import/export, kept out of shop's import-engine. One row
// per variant: the parent (by slug), the option/value pairs that define it, and
// the per-variant fields. Re-importing updates in place (variants matched by
// their exact value-set), so the export round-trips.
import { toCsvRow, parseCsv } from '@/modules/shop/lib/csv'
import { getProductBySlug } from '@/modules/shop/lib/db/products'
import { getEditorPayload, upsertVariantForCombination } from '@/modules/shop-variations/lib/variants-service'
import { getProductIdsWithVariations } from '@/modules/shop-variations/lib/db/variants'
import { getOptionsWithValues, createOption, createOptionValue } from '@/modules/shop-variations/lib/db/options'

export async function exportVariationsCsv(): Promise<string> {
  const ids = await getProductIdsWithVariations()
  const payloads = (await Promise.all(ids.map((id) => getEditorPayload(id)))).filter((p): p is NonNullable<typeof p> => !!p && p.variants.length > 0)
  const maxOptions = payloads.reduce((m, p) => Math.max(m, p.options.length), 1)

  const optionCols: string[] = []
  for (let i = 0; i < maxOptions; i++) optionCols.push(`Option ${i + 1}`, `Value ${i + 1}`)
  const lines = [toCsvRow(['Parent Slug', 'Parent Name', ...optionCols, 'Variant SKU', 'Price', 'Stock', 'Barcode', 'Weight'])]

  for (const p of payloads) {
    for (const v of p.variants) {
      const pairs: string[] = []
      for (const option of p.options) {
        const value = option.values.find((val) => v.optionValueIds.includes(val.id))
        pairs.push(option.name, value?.label ?? '')
      }
      while (pairs.length < maxOptions * 2) pairs.push('')
      lines.push(toCsvRow([
        p.product.slug, p.product.name, ...pairs,
        v.sku ?? '', String(v.price), v.stockCount != null ? String(v.stockCount) : '', v.barcode ?? '', v.weight != null ? String(v.weight) : '',
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

export async function importVariationsCsv(text: string): Promise<ImportResult> {
  const rows = parseCsv(text)
  const result: ImportResult = { created: 0, updated: 0, errors: [] }
  if (rows.length < 2) { result.errors.push({ row: 0, reason: 'No data rows found' }); return result }

  const header = (rows[0] ?? []).map((h) => h.trim())
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
  const slugCol = idx('Parent Slug')
  if (slugCol < 0) { result.errors.push({ row: 1, reason: 'Missing "Parent Slug" column' }); return result }
  const skuCol = idx('Variant SKU'), priceCol = idx('Price'), stockCol = idx('Stock'), barcodeCol = idx('Barcode'), weightCol = idx('Weight')

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

        const { created } = await upsertVariantForCombination(parent.id, optionValueIds, labels, {
          price: priceCol >= 0 ? num(gr.cols[priceCol]) : undefined,
          sku: skuCol >= 0 ? (gr.cols[skuCol]?.trim() || null) : undefined,
          barcode: barcodeCol >= 0 ? (gr.cols[barcodeCol]?.trim() || null) : undefined,
          stockCount: stockCol >= 0 ? (num(gr.cols[stockCol]) ?? null) : undefined,
          weight: weightCol >= 0 ? (num(gr.cols[weightCol]) ?? null) : undefined,
        })
        if (created) result.created += 1
        else result.updated += 1
      } catch (err) {
        result.errors.push({ row: gr.rowNum, reason: err instanceof Error ? err.message : 'Row failed' })
      }
    }
  }

  return result
}
