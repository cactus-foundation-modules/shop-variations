import {
  createOptionValue,
  getOptionWithValues,
  optionValueLabelTaken,
  updateOptionValue,
} from '@/modules/shop-variations/lib/db/options'
import type { OptionSource, OptionSourceProvider } from '@/modules/shop-variations/lib/option-sources'

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
  /** True when the source's own name no longer matches the option's name. */
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

  for (const incoming of source.values) {
    const existing = byRef.get(incoming.ref)
    if (existing) {
      const labelChanged = existing.label !== incoming.label
      const swatchChanged = (existing.swatch ?? null) !== (incoming.swatch ?? null)
      if (!labelChanged && !swatchChanged) continue
      // A rename that would collide with another value on this option is skipped
      // rather than applied: duplicate labels make the generated variant names
      // ambiguous, which the rename endpoint refuses for the same reason.
      if (labelChanged && (await optionValueLabelTaken(option.id, incoming.label, existing.id))) continue
      await updateOptionValue(existing.id, {
        label: incoming.label,
        swatch: incoming.swatch ?? null,
      })
      updated += 1
      continue
    }
    // New to us. Skip it if the owner happens to have typed the same label by
    // hand already, otherwise the option ends up with two identical values.
    if (await optionValueLabelTaken(option.id, incoming.label, '')) continue
    await createOptionValue(option.id, incoming.label, incoming.swatch ?? null, nextPosition, incoming.ref)
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
    nameDiffers: source.name !== option.name,
    sourceName: source.name,
  }
}
