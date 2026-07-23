// Variations-owned CSV import/export, kept out of shop's import-engine. One row
// per variant: the parent (by slug), the option/value pairs that define it, and
// the per-variant fields. Re-importing updates in place (variants matched by
// their exact value-set), so the export round-trips.
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { toCsvRow, parseCsv } from '@/modules/shop/lib/csv'
import { getProductBySlug, setProductMedia, updateProduct } from '@/modules/shop/lib/db/products'
import { reorganiseProductMedia } from '@/modules/shop/lib/media/product-media'
import { getEditorPayload, upsertVariantForCombination, syncVariantChildNames, type VariantUpsertContext } from '@/modules/shop-variations/lib/variants-service'
import { getProductIdsWithVariations, getVariants, getVariantValueMap, getChildProductFields, setVariantValues } from '@/modules/shop-variations/lib/db/variants'
import { getOptionsWithValues, createOption, createOptionValue, updateOptionValue, optionValueLabelTaken, deleteOptionValue } from '@/modules/shop-variations/lib/db/options'
import { resolveVariantFieldProviders } from '@/modules/shop-variations/lib/variant-field-providers'

// A variant can carry several images, so the single `Image` cell holds them all
// as a comma-separated list, primary first. One url still reads (and imports) as
// it always did, so a sheet written before this change round-trips unchanged.
// Note the shop's own product export uses `|` for its media cell; that one also
// encodes a media TYPE per entry, which this column has no need for.
const IMAGE_SEPARATOR = ', '

// The optional per-variant price columns, in editor order, sitting after Price.
// Header labels match the product editor's own so the sheet reads the same way
// the admin does; import matches them case-insensitively.
export const PRICE_TYPE_COLUMNS = ['Sale Price', 'RRP', 'Trade Price', 'Cost Price'] as const

// A price cell for export: the number as typed, or blank when the variant has
// not set that figure (null must stay tellable apart from 0 - a blank RRP is not
// a free item).
function money(value: number | null): string {
  return value == null ? '' : String(value)
}

// A price cell on import. A present-but-empty cell clears the figure to null (the
// sheet is the truth), a number sets it, and anything unparseable is treated as
// blank rather than aborting the row - the same lenient rule the Products import
// uses for its optional price columns. Only ever called for a column that exists
// in the header; an absent column passes `undefined` and leaves the field alone.
function optPrice(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function serialiseVariantImages(urls: string[]): string {
  return urls.join(IMAGE_SEPARATOR)
}

export function parseVariantImages(cell: string): string[] {
  return cell.split(',').map((s) => s.trim()).filter(Boolean)
}

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
  // The optional price types sit right after the selling Price, in the same order
  // the product editor lists them. They are always present (like the Products
  // tab's own price columns), blank where a variant hasn't set one, so the sheet
  // can carry a variant's RRP, trade and cost - not just its price.
  // Variant ID is the variant's hidden child product id - the one identity that
  // survives a rename of an option, a value, the SKU or the parent. Import (and
  // the Google-Sheet mirror's Pull) matches on it first, so editing a value label
  // in the sheet reads as "rename this variant's value", not "delete this variant
  // and create a stranger". A sheet from before the column existed still imports
  // by value-set exactly as it always did.
  const lines = [toCsvRow(['Parent Slug', 'Parent Name', ...optionCols, 'Variant SKU', 'Price', ...PRICE_TYPE_COLUMNS, 'Stock', 'Barcode', 'Supplier', 'Weight', 'Image', 'Variant ID', ...fieldHeaderOrder])]

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
        v.sku ?? '', String(v.price),
        money(v.salePrice), money(v.retailPrice), money(v.tradePrice), money(v.costPrice),
        v.stockCount != null ? String(v.stockCount) : '', v.barcode ?? '', v.supplier ?? '', v.weight != null ? String(v.weight) : '', serialiseVariantImages(v.imageUrls),
        v.childProductId,
        ...fieldCells,
      ]))
    }
  }
  return lines.join('\n')
}

export type ImportResult = { created: number; updated: number; errors: Array<{ row: number; reason: string }> }

// Stable key for a value combination - two combinations are the same variant iff
// they hold the same set of value ids (same rule variants-service uses).
function comboKey(optionValueIds: string[]): string {
  return [...optionValueIds].sort().join('|')
}

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

// Run fn over items with at most `limit` in flight at once. Used to flush the
// deferred variant writes: the queries are independent, so overlapping them
// hides the per-write round-trip latency that dominates a large Pull.
async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!
      await fn(item)
    }
  })
  await Promise.all(workers)
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
  const skuCol = idx('Variant SKU'), priceCol = idx('Price'), stockCol = idx('Stock'), barcodeCol = idx('Barcode'), supplierCol = idx('Supplier'), weightCol = idx('Weight'), imageCol = idx('Image'), idCol = idx('Variant ID')
  const salePriceCol = idx('Sale Price'), rrpCol = idx('RRP'), tradePriceCol = idx('Trade Price'), costPriceCol = idx('Cost Price')

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
    // Each value's owning option and current label, for the stable-id rename
    // pass below.
    const valueInfo = new Map<string, { optionId: string; optionName: string; label: string }>()
    for (const o of await getOptionsWithValues(parent.id)) {
      optionByName.set(o.name.toLowerCase(), { id: o.id })
      for (const v of o.values) {
        valueIdByKey.set(`${o.name.toLowerCase()}|${v.label.toLowerCase()}`, v.id)
        valueInfo.set(v.id, { optionId: o.id, optionName: o.name.toLowerCase(), label: v.label })
      }
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
    const existingVariants = await getVariants(parent.id)
    // Variant ID -> variant. The cell holds the variant's hidden child product
    // id, the one identity a rename cannot disturb.
    const variantByChildId = new Map(existingVariants.map((v) => [v.childProductId, v]))
    const upsertCtx: VariantUpsertContext = {
      parent,
      existing: existingVariants,
      valueMap: await getVariantValueMap(parent.id),
      // Every existing child's fields in one query, so upsert diffs in memory
      // instead of reading each child back per row - the bulk of a slow Pull.
      currentFields: await getChildProductFields(existingVariants.map((v) => v.childProductId)),
      // Changed-row writes collect here and flush together (concurrently) after
      // the parent's rows are decided, rather than one round-trip per row.
      pendingWrites: [],
    }

    // Which values had at least one variant on them when this call began - the
    // baseline for the orphan sweep after the rows are applied.
    const referencedBefore = new Set(Object.values(upsertCtx.valueMap).flat())

    // --- Stable-id rename pass ---
    // A row that carries a Variant ID but names a value label this parent does
    // not have is, in the common case, a rename typed into the sheet ("Red" ->
    // "Crimson" down a whole column). Without this pass those rows would mint a
    // brand-new value and a brand-new variant, stranding the original - the exact
    // delete-and-recreate this column exists to prevent. A rename is applied only
    // when it is unambiguous: every id-matched row that touches the value agrees
    // on one new label, EVERY variant currently sitting on the value is covered
    // by such a row (judged against the database, not the rows in hand - a Pull
    // feeds this importer a filtered slice of the sheet, so absence of a row
    // proves nothing), and the new label is not already taken on the option.
    // Anything ambiguous falls through to the per-row reassignment below, which
    // never guesses.
    let renamedValues = 0
    if (idCol >= 0 && optionPairs.length > 0) {
      const proposals = new Map<string, { labels: Set<string>; proposers: Set<string> }>() // valueId -> labels + proposing variant ids
      for (const gr of groupRows) {
        const childId = (gr.cols[idCol] ?? '').trim()
        const variant = childId ? variantByChildId.get(childId) : undefined
        if (!variant) continue
        const currentIds = upsertCtx.valueMap[variant.id] ?? []
        for (const pair of optionPairs) {
          const optName = (gr.cols[pair.nameCol] ?? '').trim().toLowerCase()
          const valLabel = (gr.cols[pair.valueCol] ?? '').trim()
          if (!optName || !valLabel) continue
          if (valueIdByKey.has(`${optName}|${valLabel.toLowerCase()}`)) continue // resolves already - nothing to rename
          const cur = currentIds.find((id) => valueInfo.get(id)?.optionName === optName)
          if (!cur) continue
          let entry = proposals.get(cur)
          if (!entry) { entry = { labels: new Set(), proposers: new Set() }; proposals.set(cur, entry) }
          entry.labels.add(valLabel)
          entry.proposers.add(variant.id)
        }
      }
      for (const [valueId, { labels, proposers }] of proposals) {
        if (labels.size !== 1) continue // conflicting targets - not a rename
        const info = valueInfo.get(valueId)
        if (!info) continue
        // Every variant on this value must be asking for the move, or some
        // variant the sheet did not touch would be dragged along with it.
        const covered = upsertCtx.existing.every((v) =>
          !(upsertCtx.valueMap[v.id] ?? []).includes(valueId) || proposers.has(v.id))
        if (!covered) continue
        const newLabel = [...labels][0]!
        if (await optionValueLabelTaken(info.optionId, newLabel, valueId)) continue
        await updateOptionValue(valueId, { label: newLabel })
        valueIdByKey.delete(`${info.optionName}|${info.label.toLowerCase()}`)
        valueIdByKey.set(`${info.optionName}|${newLabel.toLowerCase()}`, valueId)
        valueInfo.set(valueId, { ...info, label: newLabel })
        renamedValues += 1
      }
    }

    // Each variant's current images, prefetched once for the whole parent, in the
    // same order the export writes them (primary first). The image write below
    // re-files media through the storage provider (a network round-trip per image),
    // so doing it on every row every import - even when the cell has not changed -
    // is what pushed a large Pull past the request budget and left the later rows
    // (and their 3D files) unprocessed. With this we skip the write entirely when
    // the cell already lists exactly what is stored, in the same order.
    const currentImagesByChild = new Map<string, string[]>()
    if (imageCol >= 0) {
      const childIds = upsertCtx.existing.map((v) => v.childProductId)
      if (childIds.length > 0) {
        const media = await prisma.$queryRaw<{ product_id: string; url: string }[]>`
          SELECT "product_id", "url" FROM "shp_product_media"
          WHERE "product_id" IN (${Prisma.join(childIds)}) AND "type" = 'IMAGE'
          ORDER BY "product_id", "is_primary" DESC, "position" ASC
        `
        for (const m of media) {
          const list = currentImagesByChild.get(m.product_id)
          if (list) list.push(m.url)
          else currentImagesByChild.set(m.product_id, [m.url])
        }
      }
    }

    // Let each extra-field provider preload its current state for this parent's
    // existing children in one go, before any row is applied. It returns an
    // opaque context threaded into every applyImportedRow below, so a provider
    // that used to read a variant's current values per row now reads once per
    // parent. A child created mid-import is absent from this snapshot; providers
    // treat that context miss as empty current state (see VariantFieldProvider).
    const providerCtx = new Map<string, unknown>()
    if (providers.length > 0) {
      const childIds = upsertCtx.existing.map((v) => v.childProductId)
      for (const { id, provider } of providers) {
        if (provider.beginImport) providerCtx.set(id, await provider.beginImport(parent.id, childIds))
      }
    }

    let reassignedAny = false
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

        // Stable-id reassignment: the row names this exact variant (by child
        // product id) but a combination that differs from what it holds - an
        // ambiguous rename the pass above declined, or a re-pointed value. Move
        // the variant onto the named combination rather than letting the upsert
        // mint a duplicate and orphan the original. Refused when another variant
        // already owns that combination - that is a collision, not a rename.
        let reassignedRow = false
        if (idCol >= 0) {
          const childId = (gr.cols[idCol] ?? '').trim()
          const idVariant = childId ? variantByChildId.get(childId) : undefined
          if (idVariant) {
            const newKey = comboKey(optionValueIds)
            if (comboKey(upsertCtx.valueMap[idVariant.id] ?? []) !== newKey) {
              const clash = upsertCtx.existing.find((v) => v.id !== idVariant.id && comboKey(upsertCtx.valueMap[v.id] ?? []) === newKey)
              if (clash) { result.errors.push({ row: gr.rowNum, reason: 'That combination already belongs to another variation' }); continue }
              await setVariantValues(idVariant.id, optionValueIds)
              upsertCtx.valueMap[idVariant.id] = optionValueIds
              reassignedRow = true
              reassignedAny = true
            }
          }
        }

        const { created, changed: fieldsChanged, childProductId } = await upsertVariantForCombination(parent.id, optionValueIds, labels, {
          price: priceCol >= 0 ? num(gr.cols[priceCol]) : undefined,
          salePrice: salePriceCol >= 0 ? optPrice(gr.cols[salePriceCol]) : undefined,
          retailPrice: rrpCol >= 0 ? optPrice(gr.cols[rrpCol]) : undefined,
          tradePrice: tradePriceCol >= 0 ? optPrice(gr.cols[tradePriceCol]) : undefined,
          costPrice: costPriceCol >= 0 ? optPrice(gr.cols[costPriceCol]) : undefined,
          sku: skuCol >= 0 ? (gr.cols[skuCol]?.trim() || null) : undefined,
          barcode: barcodeCol >= 0 ? (gr.cols[barcodeCol]?.trim() || null) : undefined,
          supplier: supplierCol >= 0 ? (gr.cols[supplierCol]?.trim() || null) : undefined,
          stockCount: stockCol >= 0 ? (num(gr.cols[stockCol]) ?? null) : undefined,
          weight: weightCol >= 0 ? (num(gr.cols[weightCol]) ?? null) : undefined,
        }, upsertCtx)

        // Hand the whole row (keyed by header label) to each extra-field provider
        // so it can pick out its own columns and write them onto this variant.
        if (providers.length > 0) {
          const rowRecord: Record<string, string> = {}
          header.forEach((h, i) => { rowRecord[h] = (gr.cols[i] ?? '').trim() })
          for (const { id, provider } of providers) {
            await provider.applyImportedRow(parent.id, childProductId, rowRecord, providerCtx.get(id))
          }
        }

        // The variant's own images, stored as the hidden child product's media -
        // the same write the per-variant edit endpoint makes, first url primary.
        // An empty cell clears them (the sheet is the truth); a non-url is flagged
        // and the whole cell left alone rather than half-applied. Only touched when
        // the sheet actually carries an Image column, so a legacy sheet from before
        // this column existed leaves images alone.
        let imageChanged = false
        if (imageCol >= 0) {
          const urls = parseVariantImages(gr.cols[imageCol] ?? '')
          const current = currentImagesByChild.get(childProductId) ?? []
          const bad = urls.filter((u) => !isHttpUrl(u))
          if (bad.length > 0) {
            result.errors.push({ row: gr.rowNum, reason: `Invalid image URL: ${bad.join(', ')}` })
          } else if (urls.length === current.length && urls.every((u, i) => u === current[i])) {
            // Unchanged - skip the media rewrite and its provider re-file entirely.
          } else if (urls.length === 0) {
            await setProductMedia(childProductId, [])
            currentImagesByChild.set(childProductId, [])
            imageChanged = true
          } else {
            await setProductMedia(childProductId, urls.map((url, i) => ({ type: 'IMAGE' as const, url, isPrimary: i === 0 })))
            // File them in the parent's media-library folder, as the edit endpoint does.
            await reorganiseProductMedia(childProductId, { folderProductId: parent.id })
            currentImagesByChild.set(childProductId, urls)
            imageChanged = true
          }
        }

        // "Updated" means this row actually changed something - not every row the
        // sheet happened to list. A provider-only change (a 3D file, an attribute
        // value) isn't counted here since those already skip their own no-op
        // writes; this count reflects the variant's own fields and image.
        if (created) result.created += 1
        else if (fieldsChanged || imageChanged || reassignedRow) result.updated += 1
      } catch (err) {
        result.errors.push({ row: gr.rowNum, reason: err instanceof Error ? err.message : 'Row failed' })
      }
    }

    // Flush this parent's deferred field writes together. They're the changed
    // rows only (unchanged rows never enqueue). Deduped by child id first - a
    // sheet listing the same combination twice would otherwise queue two writes
    // for one child and the pool could apply them out of order; last row wins,
    // as it did when writes were inline. Distinct children never race, so a
    // bounded concurrent pool safely collapses the round-trips.
    // Reassignment can leave a value with no variant on it at all (a rename the
    // pass above declined, now fully migrated row by row). Sweep those: left
    // behind, a ghost value re-enters the next matrix generation as combinations
    // nobody asked for. Only values that HAD variants when this call began are
    // candidates - a value set up ahead of a matrix build is none of our
    // business - and a value any variant still sits on never qualifies.
    if (reassignedAny) {
      const referencedAfter = new Set(Object.values(upsertCtx.valueMap).flat())
      for (const valueId of referencedBefore) {
        if (referencedAfter.has(valueId)) continue
        const info = valueInfo.get(valueId)
        if (!info) continue
        await deleteOptionValue(valueId)
        valueIdByKey.delete(`${info.optionName}|${info.label.toLowerCase()}`)
        valueInfo.delete(valueId)
      }
    }

    // Renames and reassignments both leave variant child product names stale
    // (they snapshot the value labels), so re-compose them once per parent.
    // Renamed values count as updates so "N updated" owns up to the change even
    // when every other cell on the row was already right.
    if (renamedValues > 0 || reassignedAny) {
      await syncVariantChildNames(parent.id)
      result.updated += renamedValues
    }

    const pending = upsertCtx.pendingWrites ?? []
    if (pending.length > 0) {
      const lastByChild = new Map<string, (typeof pending)[number]['update']>()
      for (const w of pending) lastByChild.set(w.childId, w.update)
      await runPool([...lastByChild], 8, async ([childId, update]) => {
        try {
          await updateProduct(childId, update)
        } catch (err) {
          result.errors.push({ row: 0, reason: `Failed to save variant ${childId}: ${err instanceof Error ? err.message : 'write failed'}` })
        }
      })
    }
  }

  return result
}
