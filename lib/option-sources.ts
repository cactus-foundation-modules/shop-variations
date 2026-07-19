import { prisma } from '@/lib/db/prisma'
import { INSTALLED_MODULE_WHERE } from '@/lib/modules/live-status'
import { getSessionFromCookie } from '@/lib/auth/session'
import { hasPermission } from '@/lib/permissions/check'
import { moduleExtensionPointComponents } from '@/lib/modules/extension-points'
import type { SvrControlType } from '@/modules/shop-variations/lib/types'

// A generic way for another module to offer ready-made options - "add a Colour
// option with these five values" - instead of the shop owner typing the same
// list out again on every product.
//
// Deliberately data-only. A provider contributes no UI: it hands over a list of
// sources and their values, and the picker in VariationsPanel renders them. That
// keeps the whole feature attribute-agnostic here (this module never learns what
// an "attribute" is) and keeps the provider free of admin-UI code.
//
// Refresh works off the refs. Each option remembers its provider id and source
// ref, each copied value remembers its own ref, so a later refresh can re-read
// the source and match rows up without guessing by label - a source value that
// gets renamed still matches, and renames the copy rather than orphaning it.

export type OptionSourceValue = {
  /** Stable id of the value in the provider's own storage. Opaque to us. */
  ref: string
  label: string
  /** Hex colour or image url, matching the meaning svr_option_values.swatch has. */
  swatch: string | null
}

export type OptionSource = {
  /** Stable id of the source in the provider's storage. Opaque to us. */
  ref: string
  /** Suggested option name, e.g. the attribute's name. The picker pre-fills it and the owner may override it. */
  name: string
  /** Optional heading the picker groups sources under, e.g. an attribute group. */
  groupLabel?: string | null
  values: OptionSourceValue[]
}

export type OptionSourceProvider = {
  /** What the picker calls this provider, e.g. "Attributes". Shown on the button. */
  label: string
  /** Everything on offer. Called once when the picker opens. */
  listSources(): Promise<OptionSource[]>
  /** One source by ref, for a refresh. Null when it has since been deleted. */
  getSource(ref: string): Promise<OptionSource | null>
  /**
   * Add a value to the source itself, so a value typed on a product's Variations
   * tab lands on the attribute (or whatever the provider keeps) rather than only
   * on this one product. Returns the stored value, ref and all, which the caller
   * copies down - so the new value is sourced from the start and a later refresh
   * matches it by id rather than orphaning it.
   *
   * A label the source already carries is reused rather than refused: from a
   * product's point of view typing "Oak" on a second product is not a mistake.
   *
   * Optional. A provider whose storage is read-only (or not the owner's to write
   * to) simply leaves it off, and a typed value stays local to the product.
   */
  createValue?(ref: string, input: { label: string; swatch: string | null }): Promise<OptionSourceValue | null>
}

const POINT = 'shop-variations.option-source'

type ManifestEntry = { point: string; id: string; permission?: string }

/**
 * Providers contributed by active modules. Resolved from the stored manifests
 * rather than the generated registry alone, so that a module which is installed
 * but not active contributes nothing, and so each entry's permission is honoured.
 */
export async function resolveOptionSourceProviders(
  user?: Awaited<ReturnType<typeof getSessionFromCookie>>,
): Promise<Array<{ id: string; provider: OptionSourceProvider }>> {
  const modules = await prisma.module.findMany({
    where: { ...INSTALLED_MODULE_WHERE },
    select: { manifest: true },
  })
  const components = moduleExtensionPointComponents[POINT] ?? {}
  const out: Array<{ id: string; provider: OptionSourceProvider }> = []
  const seen = new Set<string>()
  for (const mod of modules) {
    const manifest = mod.manifest as { extensionPoints?: ManifestEntry[] } | null
    for (const entry of manifest?.extensionPoints ?? []) {
      if (entry.point !== POINT || seen.has(entry.id)) continue
      if (user && entry.permission && !(await hasPermission(user, entry.permission))) continue
      const provider = components[entry.id] as OptionSourceProvider | undefined
      if (provider) {
        out.push({ id: entry.id, provider })
        seen.add(entry.id)
      }
    }
  }
  return out
}

/** One provider by id, or null when it is absent or the user may not use it. */
export async function resolveOptionSourceProvider(
  id: string,
  user?: Awaited<ReturnType<typeof getSessionFromCookie>>,
): Promise<OptionSourceProvider | null> {
  const all = await resolveOptionSourceProviders(user)
  return all.find((p) => p.id === id)?.provider ?? null
}

/**
 * The control type a set of values suggests. Values carrying image urls want the
 * IMAGE control, hex colours want SWATCH, and anything else stays on the plain
 * dropdown. Only a suggestion - the picker offers it as the pre-selection and the
 * shop owner can pick something else before creating the option.
 */
export function suggestControlType(values: OptionSourceValue[]): SvrControlType {
  const swatches = values.map((v) => v.swatch).filter((s): s is string => Boolean(s))
  if (swatches.length === 0) return 'DROPDOWN'
  // Mixed sets fall back to the dropdown rather than rendering half the values
  // as blanks in a swatch grid.
  if (swatches.every((s) => /^#[0-9a-f]{3,8}$/i.test(s))) return 'SWATCH'
  if (swatches.every((s) => !s.startsWith('#'))) return 'IMAGE'
  return 'DROPDOWN'
}
