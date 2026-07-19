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

export function OptionSourcePicker({ providers, existingNames, onCancel, onConfirm }: {
  providers: PickerProvider[]
  /** Option names already on this product, lower-cased, so a clash is caught before the request. */
  existingNames: string[]
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

  function choose(providerId: string, source: PickerSource) {
    setChosen({ providerId, source })
    // Pre-fill the name from the source and tick everything: bringing the whole
    // list across is the common case, and unticking a few beats ticking twenty.
    setName(source.name)
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
                  <div key={groupLabel ?? '_'} style={{ display: 'grid', gap: '0.375rem' }}>
                    {groupLabel && (
                      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{groupLabel}</span>
                    )}
                    {sources.map((source) => (
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
                        <span style={{ fontWeight: 500 }}>{source.name}</span>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                          {source.values.length} {source.values.length === 1 ? 'value' : 'values'}
                        </span>
                      </button>
                    ))}
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
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  Starts as the source&apos;s own name. Change it and this product keeps your version, refresh or no refresh.
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
            <button type="button" className="btn btn-primary btn-sm" onClick={confirm} disabled={saving || ticked.size === 0 || !name.trim()}>
              {saving ? 'Adding...' : 'Add option'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Sources keep their server order; the grouping only gathers each heading's runs
// so a group that appears once stays where the provider put it.
function groupSources(sources: PickerSource[]): Array<[string | null, PickerSource[]]> {
  const out: Array<[string | null, PickerSource[]]> = []
  for (const source of sources) {
    const last = out[out.length - 1]
    if (last && last[0] === source.groupLabel) last[1].push(source)
    else out.push([source.groupLabel, [source]])
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
