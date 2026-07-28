// What a renamed option value should now point at in its source.
//
// A sourced option value carries the id of the source value it was copied from
// (`source_ref`). That ref, not the label, is what a "Refresh from source" and
// the attributes module's own push both match on - so a value whose label has
// moved on but whose ref has not is a live fault, not an untidiness: the next
// edit to the OLD source value silently rewrites this one's label and swatch.
//
// That is exactly what happened to the Impulse desks. A sheet import renamed the
// "Silver" leg finish to "Black" on eight products; the ref stayed on Silver, so
// when Silver's swatch was set the Black values took Silver's grey.
//
// This decides the repoint. Kept pure and separate from the importer so the
// rules can be read (and tested) without a database.

export type SourceValue = { ref: string; label: string; swatch: string | null }

export type Repoint =
  /** Adopt a different source value. `swatch` undefined = leave the stored one alone. */
  | { kind: 'adopt'; ref: string; swatch?: string | null }
  /** The value no longer answers to anything in the source: stop tracking it. */
  | { kind: 'clear' }
  /** Nothing to do. */
  | { kind: 'keep' }

export type RepointInput = {
  /** The ref stored on the value before the rename. */
  currentSourceRef: string | null
  /** The swatch stored on the value before the rename. */
  currentSwatch: string | null
  /** The label it has just been renamed to. */
  newLabel: string
  /** The source's values as they stand now. Empty when the option has no source. */
  sourceValues: SourceValue[]
  /** Refs held by the option's OTHER values, so one source value is not claimed twice. */
  siblingRefs: (string | null)[]
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function repointOnRename(input: RepointInput): Repoint {
  const { currentSourceRef, currentSwatch, newLabel, sourceValues, siblingRefs } = input

  // A hand-typed value owns itself, and an option with no source has nothing to
  // point at. Neither can drift, so neither is touched.
  if (!currentSourceRef || sourceValues.length === 0) return { kind: 'keep' }

  const matches = sourceValues.filter((v) => sameLabel(v.label, newLabel))

  // Two source values sharing a label is not something this can resolve without
  // guessing, and guessing is how the fault above was made in the first place.
  if (matches.length !== 1) {
    // The ref still resolves, but to a value called something else: leave it in
    // place and that source value's next edit drags this one back to its label.
    // Cut the link instead - the value keeps what the sheet named it, and the
    // refresh treats it as hand-typed from here (it is: nothing in the source
    // says this any more).
    const current = sourceValues.find((v) => v.ref === currentSourceRef)
    if (current && !sameLabel(current.label, newLabel)) return { kind: 'clear' }
    // Ref already gone from the source: that is the "stale" case the refresh
    // reports out loud, and not this function's business to resolve.
    return { kind: 'keep' }
  }

  const match = matches[0]!
  if (match.ref === currentSourceRef) return { kind: 'keep' }

  // Another value on the same option is already this source value. Two values
  // sharing one ref makes the refresh's ref -> value map ambiguous, so this one
  // stops tracking the source rather than joining the collision.
  if (siblingRefs.some((ref) => ref === match.ref)) return { kind: 'clear' }

  // Take the new source value's swatch only where the stored one was the old
  // source value's to begin with (or absent). A swatch the owner picked by hand
  // survives a rename, the same way a hand-typed value does.
  const previous = sourceValues.find((v) => v.ref === currentSourceRef)
  const inherited = currentSwatch === null || (previous ? currentSwatch === previous.swatch : false)
  return inherited
    ? { kind: 'adopt', ref: match.ref, swatch: match.swatch }
    : { kind: 'adopt', ref: match.ref }
}
