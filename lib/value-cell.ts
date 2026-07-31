// The spreadsheet spelling of an option value: "(slug)Label", e.g.
// "(black-mfc)Black". The slug is the value's identity within its option, the
// label is what shoppers see - carrying both lets a sheet hold two values that
// read "Black" without ever confusing them, and lets a Pull rename a label while
// the slug pins down which value it means.
//
// Kept pure so the exporter, the importer and the Google-Sheet module's diff all
// parse a cell the same way.

// A slug as this platform mints them: lowercase letters, digits and hyphens.
// The shape check is what keeps a label that genuinely starts with brackets -
// "(Left) Return", "(Special) Black" - reading as a plain label: "Left" is not
// slug-shaped, so no slug is seen.
const CELL = /^\(([a-z0-9][a-z0-9-]{0,99})\)(.+)$/

export function serialiseValueCell(slug: string, label: string): string {
  return `(${slug})${label}`
}

export type ParsedValueCell = {
  /** Null when the cell is a bare label (a legacy sheet, or a hand-typed cell). */
  slug: string | null
  label: string
}

export function parseValueCell(cell: string): ParsedValueCell {
  const trimmed = cell.trim()
  const m = CELL.exec(trimmed)
  if (!m) return { slug: null, label: trimmed }
  const label = m[2]!.trim()
  // "(black-mfc)" with nothing after it names no value; treat the whole cell as
  // a label rather than inventing an empty one.
  if (!label) return { slug: null, label: trimmed }
  return { slug: m[1]!, label }
}
