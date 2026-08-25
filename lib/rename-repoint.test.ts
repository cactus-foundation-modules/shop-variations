import { describe, it, expect } from 'vitest'
import { repointOnRename, type SourceValue } from '@/modules/shop-variations/lib/rename-repoint'

// The Leg Finish attribute the Impulse desks are built from.
const LEG_FINISH: SourceValue[] = [
  { ref: 'silver', label: 'Silver', swatch: '#7E7E7E' },
  { ref: 'black', label: 'Black', swatch: '#323232' },
  { ref: 'white', label: 'White', swatch: '#f3f3f3' },
]

describe('repointOnRename', () => {
  it('moves the ref (and the inherited swatch) to the source value the new label names', () => {
    // The fault on the desks: a sheet renamed Silver to Black, the ref stayed on
    // Silver, and Silver's swatch edit then painted every "Black" grey.
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#7E7E7E',
        newLabel: 'Black',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'adopt', ref: 'black', swatch: '#323232', swatchSmall: null, swatchTiny: null })
  })

  it('matches the label regardless of case and surrounding space', () => {
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#7E7E7E',
        newLabel: '  black ',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'adopt', ref: 'black', swatch: '#323232', swatchSmall: null, swatchTiny: null })
  })

  it('keeps a swatch the owner set by hand, and still moves the ref', () => {
    // #111 is nobody's source swatch, so it was typed in. The link moves; the
    // colour the owner chose stays.
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#111111',
        newLabel: 'Black',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'adopt', ref: 'black' })
  })

  it('fills an empty swatch from the source it has just adopted', () => {
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: null,
        newLabel: 'Black',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'adopt', ref: 'black', swatch: '#323232', swatchSmall: null, swatchTiny: null })
  })

  it('cuts the link when another value on the option is already that source value', () => {
    // Two copies of one source value make the refresh's ref -> value map
    // ambiguous, which is the ambiguity this whole fix exists to remove.
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#7E7E7E',
        newLabel: 'Black',
        sourceValues: LEG_FINISH,
        siblingRefs: ['black', 'white'],
      }),
    ).toEqual({ kind: 'clear' })
  })

  it('cuts the link when the new label is in no source value at all', () => {
    // Renamed to something the attribute list has never heard of: it is the
    // sheet's value now, and Silver's next edit must not reach it.
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#7E7E7E',
        newLabel: 'Gunmetal',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'clear' })
  })

  it('leaves a value alone when the rename only changes the case of the label', () => {
    expect(
      repointOnRename({
        currentSourceRef: 'black',
        currentSwatch: '#323232',
        newLabel: 'BLACK',
        sourceValues: LEG_FINISH,
        siblingRefs: ['silver'],
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('leaves a hand-typed value (no ref) alone', () => {
    expect(
      repointOnRename({
        currentSourceRef: null,
        currentSwatch: '#000000',
        newLabel: 'Black',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('leaves an option with no source alone', () => {
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#7E7E7E',
        newLabel: 'Black',
        sourceValues: [],
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('leaves an already-stale ref for the refresh to report', () => {
    // The source value is gone. "Stale" is the refresh's word to say, not this
    // function's to quietly resolve.
    expect(
      repointOnRename({
        currentSourceRef: 'deleted-long-ago',
        currentSwatch: '#7E7E7E',
        newLabel: 'Gunmetal',
        sourceValues: LEG_FINISH,
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'keep' })
  })

  it('cuts the link rather than guess when two source values share the new label', () => {
    expect(
      repointOnRename({
        currentSourceRef: 'silver',
        currentSwatch: '#7E7E7E',
        newLabel: 'Black',
        sourceValues: [...LEG_FINISH, { ref: 'black-2', label: 'black', swatch: '#000000' }],
        siblingRefs: [],
      }),
    ).toEqual({ kind: 'clear' })
  })
})
