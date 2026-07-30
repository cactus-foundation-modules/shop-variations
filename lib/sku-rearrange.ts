// Applying a batch of SKU changes under a global UNIQUE(sku) index.
//
// A variant's SKU lives on its hidden child product, and that column carries a
// UNIQUE index (shp_products_sku_key). The CSV/Sheet importer writes each changed
// variant separately, so when a sheet REARRANGES SKUs among a product's variants
// - the owner swaps two colours, or shifts a whole column of codes down one - the
// writes land one at a time and, part way through, two variants momentarily want
// the same SKU: the one moving onto "X" collides with the one still holding "X".
// Postgres rejects the second with 23505, that variant keeps its OLD SKU, and the
// product ends up half-swapped. A straight two-way swap is a cycle with no safe
// order at all.
//
// The fix is to clear the blocking SKUs to NULL first (many NULLs are allowed
// under a UNIQUE index), then write the new values against rows that no longer
// hold them. This module decides the MINIMAL set to clear: only a variant whose
// current SKU is one that some OTHER variant in the same batch is moving onto.
// A variant nobody is competing for is left untouched, and a genuine duplicate
// (two rows asking for one SKU, or a SKU another product already owns) still
// surfaces as an error rather than being silently resolved.

export type SkuMove = {
  // The variant's child product id.
  id: string
  // Its SKU before this batch, and the SKU the batch is about to write. null is a
  // blank SKU (cleared). Only variants whose SKU actually changes belong here.
  from: string | null
  to: string | null
}

// The child product ids whose SKU must be set to NULL before the batch is
// applied. A variant qualifies when it still holds a SKU that another variant in
// the batch is moving onto - it is standing in the way of that target. Clearing
// exactly these breaks every swap and rotation while touching nothing else.
export function skusToClearForRearrange(moves: readonly SkuMove[]): string[] {
  const targets = new Set<string>()
  for (const m of moves) if (m.to != null) targets.add(m.to)

  const out: string[] = []
  for (const m of moves) {
    // Its SKU is genuinely moving (from !== to) and someone else wants the value
    // it currently holds: clear it so their write has somewhere to land.
    if (m.from != null && m.from !== m.to && targets.has(m.from)) out.push(m.id)
  }
  return out
}

// A product that currently holds a SKU some write in the batch wants.
export type SkuHolder = {
  id: string
  sku: string
  name: string
}

export type ExternalSkuBlocker = {
  // The child product whose write wants the SKU.
  wanterId: string
  sku: string
  // The product standing on it.
  blocker: SkuHolder
}

// The clearing pass above only ever clears variants INSIDE the batch, because
// those are the only rows it knows about. A SKU held by any product outside the
// batch - most often an orphaned child left behind by a deleted parent, but
// equally a plain product typed with the same code - fails the write with 23505
// and, because the sheet still differs from the database afterwards, fails it
// again on every future import until someone digs the blocker out by hand. This
// names them up front so the import can say WHICH product is in the way instead
// of parroting Postgres.
//
// A holder whose id is the wanter itself (already holds its own target), or one
// the clearing pass is about to set to NULL, is not a blocker.
export function externalSkuBlockers(
  wanted: ReadonlyArray<{ id: string; sku: string }>,
  holders: readonly SkuHolder[],
  clearedIds: ReadonlySet<string>,
): ExternalSkuBlocker[] {
  const holderBySku = new Map<string, SkuHolder>()
  for (const h of holders) holderBySku.set(h.sku, h)
  const out: ExternalSkuBlocker[] = []
  for (const w of wanted) {
    const holder = holderBySku.get(w.sku)
    if (!holder || holder.id === w.id || clearedIds.has(holder.id)) continue
    out.push({ wanterId: w.id, sku: w.sku, blocker: holder })
  }
  return out
}
