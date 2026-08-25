import {
  createOptionValue,
  ensureUniqueOptionValueSlug,
  getOptionWithValues,
  updateOptionValue,
} from '@/modules/shop-variations/lib/db/options'
import type { OptionSource, OptionSourceProvider } from '@/modules/shop-variations/lib/option-sources'
import { slugify } from '@/modules/shop/lib/slug'

// Re-reads a sourced option against its provider and brings it back into line.
//
// The rules are deliberately additive, because an option value is not just a
// label: variants hang off it, and each variant is a real child product with its
// own price, stock and SKU. Deleting one to mirror a source deletion would take
// that with it. So:
//
//   - a source value already copied here  -> label and swatch updated in place
//   - a source value not copied here yet  -> added at the end
//   - a copied value gone from the source -> LEFT ALONE, and reported as stale
//   - a value added here by hand (no ref) -> left alone, always
//
// Nothing is ever removed. Anything the shop owner needs to act on is handed
// back for the UI to say out loud, rather than quietly resolved.

export type OptionRefreshResult = {
  /** Source values copied in for the first time. */
  added: number
  /** Copies whose label or swatch had drifted from the source. */
  updated: number
  /**
   * Labels of copies whose source value no longer exists. Kept, not deleted,
   * because variants may depend on them - the owner decides what to do.
   */
  stale: string[]
  /**
   * True when the source's own name no longer matches the option's name AND the
   * owner has not deliberately renamed it. A renamed option stays quiet: with one
   * source added to a product twice, the difference is the whole point.
   */
  nameDiffers: boolean
  /** The source's current name, for the UI to offer as a rename. */
  sourceName: string
}

export class OptionSourceGoneError extends Error {
  constructor() {
    super('That source no longer exists.')
    this.name = 'OptionSourceGoneError'
  }
}

/**
 * Refresh one option from its provider. The option's own name is NOT touched -
 * it is overridable by design, and silently undoing an override on every refresh
 * would make the override worthless. The caller is told the name differs and can
 * offer the rename separately.
 */
export async function refreshOptionFromSource(
  optionId: string,
  provider: OptionSourceProvider,
): Promise<OptionRefreshResult> {
  const option = await getOptionWithValues(optionId)
  if (!option || !option.sourceRef) throw new OptionSourceGoneError()

  const source: OptionSource | null = await provider.getSource(option.sourceRef)
  if (!source) throw new OptionSourceGoneError()

  const byRef = new Map(option.values.filter((v) => v.sourceRef).map((v) => [v.sourceRef as string, v]))
  const sourceRefs = new Set(source.values.map((v) => v.ref))

  let added = 0
  let updated = 0
  let nextPosition = option.values.reduce((max, v) => Math.max(max, v.position + 1), 0)

  // Dedupe and identity run on slugs now, not labels: two source values may both
  // read "Black" (different swatches, different slugs), and both belong here.
  const slugsHeld = new Set(option.values.map((v) => v.slug))
  for (const incoming of source.values) {
    const existing = byRef.get(incoming.ref)
    if (existing) {
      const labelChanged = existing.label !== incoming.label
      const swatchChanged = (existing.swatch ?? null) !== (incoming.swatch ?? null)
      // The shrunk copies follow the swatch. A provider from before either copy
      // existed omits the field entirely; the stored one is then left alone
      // rather than read as "clear it" - undefined and null mean different
      // things here on purpose.
      const smallChanged = incoming.swatchSmall !== undefined && (existing.swatchSmall ?? null) !== (incoming.swatchSmall ?? null)
      const tinyChanged = incoming.swatchTiny !== undefined && (existing.swatchTiny ?? null) !== (incoming.swatchTiny ?? null)
      // The copy's slug follows the source's, so the sheet spelling stays the
      // same everywhere - but only when the source's slug is free on this option
      // (another value may have claimed it by hand).
      const sourceSlug = incoming.slug ?? null
      const slugChanged = sourceSlug !== null && sourceSlug !== existing.slug && !slugsHeld.has(sourceSlug)
      if (!labelChanged && !swatchChanged && !smallChanged && !tinyChanged && !slugChanged) continue
      await updateOptionValue(existing.id, {
        label: incoming.label,
        swatch: incoming.swatch ?? null,
        ...(incoming.swatchSmall !== undefined ? { swatchSmall: incoming.swatchSmall ?? null } : {}),
        ...(incoming.swatchTiny !== undefined ? { swatchTiny: incoming.swatchTiny ?? null } : {}),
        ...(slugChanged ? { slug: sourceSlug } : {}),
      })
      if (slugChanged) {
        slugsHeld.delete(existing.slug)
        slugsHeld.add(sourceSlug)
      }
      updated += 1
      continue
    }
    // New to us. Skip it if a value already answers to its slug - the owner
    // typed the same thing by hand before the source knew it, and adding a
    // second copy would put two identical values on the option.
    const wantedSlug = incoming.slug || slugify(incoming.label) || 'value'
    if (slugsHeld.has(wantedSlug)) continue
    const slug = await ensureUniqueOptionValueSlug(option.id, wantedSlug)
    await createOptionValue(option.id, incoming.label, slug, incoming.swatch ?? null, nextPosition, incoming.ref, incoming.swatchSmall ?? null, incoming.swatchTiny ?? null)
    slugsHeld.add(slug)
    nextPosition += 1
    added += 1
  }

  const stale = option.values
    .filter((v) => v.sourceRef && !sourceRefs.has(v.sourceRef))
    .map((v) => v.label)

  return {
    added,
    updated,
    stale,
    nameDiffers: !option.nameOverridden && source.name !== option.name,
    sourceName: source.name,
  }
}
