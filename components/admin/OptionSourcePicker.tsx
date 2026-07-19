'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SvrControlType } from '@/modules/shop-variations/lib/types'

// The "add an option from somewhere else" dialog. Another module offers ready
// made options through the `shop-variations.option-source` point - attributes
// today - and this picks one, picks which of its values to bring across, and
// lets the shop owner give the option a different name from the source's.
//
// This component knows nothing about attributes. Everything it renders comes
// from /admin/option-sources, so a second source module needs no change here.
//
// One source may be added to the same product more than once - a chair whose
// frame and seat both come off the one Colour attribute. Options must still have
// unique names on a product, so every copy after the first has to be renamed
// here before it can be added. That is the whole mechanism: the name field, not
// a separate mode.

export type PickerValue = { ref: string; label: string; swatch: string | null }
export type PickerSource = {
  ref: string
  name: string
  groupLabel: string | null
  suggestedControlType: SvrControlType
  values: PickerValue[]
}
export type PickerProvider = { id: string; label: string; sources: PickerSource[] }

export type OptionSourceSelection = {
  provider: string
  ref: string
  valueRefs: string[]
  name: string
  controlType: SvrControlType
}

const CONTROL_OPTIONS: { value: SvrControlType; label: string }[] = [
  { value: 'DROPDOWN', label: 'Dropdown' },
  { value: 'PILL', label: 'Pills' },
  { value: 'SWATCH', label: 'Colour swatch' },
  { value: 'IMAGE', label: 'Image swatch' },
]

/** An option already on the product, so the picker can spot clashes and repeats. */
export type ExistingOption = { name: string; sourceProvider: string | null; sourceRef: string | null }

export function OptionSourcePicker({ providers, existingOptions, onCancel, onConfirm }: {
  providers: PickerProvider[]
  /** Options already on this product, so a name clash is caught before the request and a repeat source is announced. */
  existingOptions: ExistingOption[]
  onCancel: () => void
  onConfirm: (selection: OptionSourceSelection) => Promise<void>
}) {
  // Which source is being configured. Null while still browsing the list.
  const [chosen, setChosen] = useState<{ providerId: string; source: PickerSource } | null>(null)
  const [name, setName] = useState('')
  const [controlType, setControlType] = useState<SvrControlType>('DROPDOWN')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escape closes, matching every other dialog in the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  const existingNames = useMemo(
    () => existingOptions.map((o) => o.name.toLowerCase()),
    [existingOptions],
  )

  /** The names this product already gives a source, so a repeat can say so. */
  const namesUsedFor = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const option of existingOptions) {
      if (!option.sourceProvider || !option.sourceRef) continue
      const key = `${option.sourceProvider}|${option.sourceRef}`
      map.set(key, [...(map.get(key) ?? []), option.name])
    }
    return map
  }, [existingOptions])

  const alreadyUsedAs = (providerId: string, ref: string) => namesUsedFor.get(`${providerId}|${ref}`) ?? []

  function choose(providerId: string, source: PickerSource) {
    setChosen({ providerId, source })
    // Pre-fill the name from the source and tick everything: bringing the whole
    // list across is the common case, and unticking a few beats ticking twenty.
    // When the source's own name is already spoken for on this product - usually
    // because this is the second helping of the same attribute - the field starts
    // empty instead, since a name of its own is the one thing this copy needs and
    // pre-filling one that cannot be used only invites a click that fails.
    setName(existingNames.includes(source.name.trim().toLowerCase()) ? '' : source.name)
    setControlType(source.suggestedControlType)
    setTicked(new Set(source.values.map((v) => v.ref)))
    setError(null)
  }

  const nameClashes = useMemo(
    () => existingNames.includes(name.trim().toLowerCase()),
    [existingNames, name],
  )

  async function confirm() {
    if (!chosen) return
    const trimmed = name.trim()
    if (!trimmed) { setError('Give the option a name.'); return }
    if (nameClashes) { setError(`This product already has an option called "${trimmed}".`); return }
    if (ticked.size === 0) { setError('Pick at least one value.'); return }
    setSaving(true); setError(null)
    try {
      await onConfirm({
        provider: chosen.providerId,
        ref: chosen.source.ref,
        // Submit in the source's own order, not tick order, so the option's
        // values line up with how they read in the source module.
        valueRefs: chosen.source.values.map((v) => v.ref).filter((ref) => ticked.has(ref)),
        name: trimmed,
        controlType,
      })
    } catch {
      setError('Could not add that option. Try again.')
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add an option from a source"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onCancel() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div style={{
        background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)', width: 'min(560px, 100%)', maxHeight: '80vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          <strong>{chosen ? `Add "${chosen.source.name}" as an option` : 'Add an option from a source'}</strong>
        </div>

        <div style={{ padding: '1rem', overflowY: 'auto', display: 'grid', gap: '0.75rem' }}>
          {!chosen ? (
            providers.map((provider) => (
              <div key={provider.id} style={{ display: 'grid', gap: '0.5rem' }}>
                {providers.length > 1 && (
                  <strong style={{ fontSize: '0.875rem' }}>{provider.label}</strong>
                )}
                {groupSources(provider.sources).map(([groupLabel, sources]) => (
                  // Ungrouped runs share a null label, so the first source's ref
                  // keys them; a labelled section is unique by its label.
                  <div key={groupLabel ?? sources[0]?.ref ?? '_'} style={{ display: 'grid', gap: '0.375rem' }}>
                    {groupLabel && (
                      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{groupLabel}</span>
                    )}
                    {sources.map((source) => {
                      // Already on this product? Say so and carry on offering it -
                      // a product can want the same list twice under two names.
                      const used = alreadyUsedAs(provider.id, source.ref)
                      return (
                        <button
                          key={source.ref}
                          type="button"
                          onClick={() => choose(provider.id, source)}
                          style={{
                            textAlign: 'left', display: 'flex', justifyContent: 'space-between', gap: '0.75rem',
                            alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--color-bg-subtle)',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                            color: 'var(--color-text)', cursor: 'pointer',
                          }}
                        >
                          <span style={{ display: 'grid', gap: '0.125rem' }}>
                            <span style={{ fontWeight: 500 }}>{source.name}</span>
                            {used.length > 0 && (
                              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                                Already added as {used.map((n) => `"${n}"`).join(', ')}
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                            {source.values.length} {source.values.length === 1 ? 'value' : 'values'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            ))
          ) : (
            <>
              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.875rem' }}>
                <span>Option name</span>
                <input
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(null) }}
                  disabled={saving}
                  style={{
                    padding: '0.375rem 0.5rem', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)',
                  }}
                />
                <span style={{ fontSize: '0.8125rem', color: nameClashes ? 'var(--color-danger)' : 'var(--color-text-muted)' }}>
                  {nameClashes
                    ? `This product already has an option called "${name.trim()}". Give this one a name of its own.`
                    : alreadyUsedAs(chosen.providerId, chosen.source.ref).length > 0
                      ? `Already on this product as ${alreadyUsedAs(chosen.providerId, chosen.source.ref).map((n) => `"${n}"`).join(', ')}, so this one needs a name of its own - "Seat colour", say.`
                      : 'Starts as the source’s own name. Change it and this product keeps your version, refresh or no refresh.'}
                </span>
              </label>

              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.875rem' }}>
                <span>Shown as</span>
                <select
                  value={controlType}
                  onChange={(e) => setControlType(e.target.value as SvrControlType)}
                  disabled={saving}
                  style={{
                    padding: '0.375rem 0.5rem', border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)',
                  }}
                >
                  {CONTROL_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>

              <div style={{ display: 'grid', gap: '0.375rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.875rem' }}>Values to add ({ticked.size} of {chosen.source.values.length})</span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={saving}
                    onClick={() => setTicked(ticked.size === chosen.source.values.length ? new Set() : new Set(chosen.source.values.map((v) => v.ref)))}
                  >
                    {ticked.size === chosen.source.values.length ? 'Untick all' : 'Tick all'}
                  </button>
                </div>
                <div style={{ display: 'grid', gap: '0.125rem', maxHeight: 220, overflowY: 'auto' }}>
                  {chosen.source.values.map((value) => (
                    <label key={value.ref} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.875rem', padding: '0.125rem 0' }}>
                      <input
                        type="checkbox"
                        checked={ticked.has(value.ref)}
                        disabled={saving}
                        onChange={(e) => {
                          const next = new Set(ticked)
                          if (e.target.checked) next.add(value.ref); else next.delete(value.ref)
                          setTicked(next)
                          setError(null)
                        }}
                      />
                      <SwatchDot swatch={value.swatch} />
                      <span>{value.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          {error && <p className="spe-error" role="alert"><span aria-hidden>⚠</span>{error}</p>}
        </div>

        <div style={{ padding: '1rem', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          {chosen && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChosen(null)} disabled={saving}>Back</button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel} disabled={saving}>Cancel</button>
          {chosen && (
            <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={saving || ticked.size === 0 || !name.trim() || nameClashes}>
              {saving ? 'Adding...' : 'Add option'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Each heading appears exactly once, where its first source sits; later sources
// carrying the same heading join that section rather than opening a second one.
// A provider whose list interleaves grouped and ungrouped sources would
// otherwise repeat its headings - one "Materials" section per run - which reads
// as duplicate groups. Ungrouped sources (null label) are the exception: they
// have no heading to merge under, so each run stays where the provider put it.
function groupSources(sources: PickerSource[]): Array<[string | null, PickerSource[]]> {
  const out: Array<[string | null, PickerSource[]]> = []
  const byLabel = new Map<string, PickerSource[]>()
  for (const source of sources) {
    if (source.groupLabel === null) {
      const last = out[out.length - 1]
      if (last && last[0] === null) last[1].push(source)
      else out.push([null, [source]])
      continue
    }
    const existing = byLabel.get(source.groupLabel)
    if (existing) { existing.push(source); continue }
    const section: PickerSource[] = [source]
    byLabel.set(source.groupLabel, section)
    out.push([source.groupLabel, section])
  }
  return out
}

// A small preview beside a value so a colour or picture list is readable at a
// glance. Silent when the value has no swatch.
function SwatchDot({ swatch }: { swatch: string | null }) {
  if (!swatch) return null
  const isColour = swatch.startsWith('#')
  return (
    <span
      aria-hidden
      style={{
        width: 14, height: 14, borderRadius: 'var(--radius-full)', flexShrink: 0,
        border: '1px solid var(--color-border)',
        background: isColour ? swatch : `center / cover no-repeat url(${JSON.stringify(swatch)})`,
      }}
    />
  )
}
