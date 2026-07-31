import { describe, it, expect } from 'vitest'
import { serialiseValueCell, parseValueCell } from '@/modules/shop-variations/lib/value-cell'

// The sheet spelling of a value - "(slug)Label" - has to round-trip exactly, and
// a bare label (a legacy sheet, or one typed by hand) has to keep reading as a
// label. The traps are labels that genuinely start with brackets.

describe('value cells', () => {
  it('round-trips slug and label', () => {
    const cell = serialiseValueCell('black-mfc', 'Black')
    expect(cell).toBe('(black-mfc)Black')
    expect(parseValueCell(cell)).toEqual({ slug: 'black-mfc', label: 'Black' })
  })

  it('reads a bare label as a label with no slug', () => {
    expect(parseValueCell('Black')).toEqual({ slug: null, label: 'Black' })
    expect(parseValueCell('  Oak & White ')).toEqual({ slug: null, label: 'Oak & White' })
  })

  it('does not mistake a bracketed label for a slug', () => {
    // "Left" is not slug-shaped (uppercase), so the whole cell is the label.
    expect(parseValueCell('(Left) Return')).toEqual({ slug: null, label: '(Left) Return' })
  })

  it('treats a slug with nothing after it as a label', () => {
    expect(parseValueCell('(black-mfc)')).toEqual({ slug: null, label: '(black-mfc)' })
  })

  it('trims the label half of a slugged cell', () => {
    expect(parseValueCell('(black-mfc) Black ')).toEqual({ slug: 'black-mfc', label: 'Black' })
  })

  it('lets two same-label values stay tellable apart', () => {
    const a = parseValueCell('(black-mfc)Black')
    const b = parseValueCell('(black-fabric)Black')
    expect(a.label).toBe(b.label)
    expect(a.slug).not.toBe(b.slug)
  })
})
