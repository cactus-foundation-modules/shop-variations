// How a product card's option summary travels to the browser.
//
// The summary itself is server-rendered markup, but two islands need it as a
// prop: the preview island (CardOptionPreview) whenever the owner has "Preview
// the photo" on, and the measuring row (FitOptionRow) for an option set to "as
// many as fit on N lines". Both are handed every value the card could show, and
// the spelled-out version of a value is mostly one long address repeated:
//
//   {"label":"Black","swatch":"https://media.deskwell.co.uk/media/shop/attributes/
//    dynamic/upholstery-colour/thumb/KgFBxH-sBNdyEUSQzSc3T-black-tiny.webp","vi":0}
//
// Measured on deskwell.co.uk's homepage, September 2026: 41 preview islands
// carrying 130 KB of this between them, 425 of the values in fit mode, where the
// browser has to be sent all of them because only it knows how many fit. Every
// swatch on a card sits in one or two folders.
//
// So a card's summaries travel with their folders named once:
//
//   { folders: [folder, ...], options: [{ ...summary, values: [[label, swatch, seat]] }] }
//
// where a swatch is null, a colour (anything with no slash in it, kept as it
// is), or [folder seat, file name]. Same values, same order, same everything the
// rows draw - a little over half the bytes on that page.
//
// Lossless by construction, as with shop's card images (lib/card-media-pack.ts
// there, whose idea this borrows): an address is split at its last slash and
// rejoined by concatenation. One corner is normalised: a value's `vi` always
// comes back as a key, holding undefined where it had none - which is how
// summariseOptionForCard writes a value with no preview seat in the first place.
//
// Client-safe and prisma-free, like card-options.ts beside it: the card block that
// packs is also an editor component, and the islands that unpack are client code.
import type { CardOptionSummary, CardOptionValue } from '@/modules/shop-variations/lib/card-options'

/** A swatch: none, a colour (or anything else with no slash in it) as it is, or a folder seat and a file name. */
export type PackedCardSwatch = null | string | [folder: number, file: string]

/** One value. Trailing parts are left off when there is nothing in them: no seat, then no swatch either. */
export type PackedCardOptionValue =
  | [label: string]
  | [label: string, swatch: PackedCardSwatch]
  | [label: string, swatch: PackedCardSwatch, seat: number]

export type PackedCardOptionSummary = Omit<CardOptionSummary, 'values'> & { values: PackedCardOptionValue[] }

export type PackedCardOptions = {
  // Folder prefixes, each INCLUDING its trailing slash.
  folders: string[]
  options: PackedCardOptionSummary[]
}

function packSwatch(swatch: string | null, seatOfFolder: (folder: string) => number): PackedCardSwatch {
  if (swatch === null || !swatch.includes('/')) return swatch
  const cut = swatch.lastIndexOf('/') + 1
  return [seatOfFolder(swatch.slice(0, cut)), swatch.slice(cut)]
}

function unpackSwatch(swatch: PackedCardSwatch | undefined, folders: string[]): string | null {
  if (swatch === undefined || swatch === null) return null
  if (typeof swatch === 'string') return swatch
  return (folders[swatch[0]] ?? '') + swatch[1]
}

function packValue(value: CardOptionValue, seatOfFolder: (folder: string) => number): PackedCardOptionValue {
  const swatch = packSwatch(value.swatch, seatOfFolder)
  if (value.vi !== undefined) return [value.label, swatch, value.vi]
  if (swatch !== null) return [value.label, swatch]
  return [value.label]
}

// A card's summaries are packed on every render of its block, and the islands
// below compare what they are handed by identity - a fit row starts measuring
// again the moment its option is a different object, and the preview island
// resets its picks. On the live page the block renders once, but in the editor it
// renders on every change to the layout, so the answer is kept against the list
// it was made from: the same list in, the same packed object out.
const packedBySummaries = new WeakMap<CardOptionSummary[], PackedCardOptions>()

export function packCardOptions(options: CardOptionSummary[]): PackedCardOptions {
  const remembered = packedBySummaries.get(options)
  if (remembered) return remembered
  const folders: string[] = []
  const folderSeats = new Map<string, number>()
  const seatOfFolder = (folder: string): number => {
    let seat = folderSeats.get(folder)
    if (seat === undefined) {
      seat = folders.push(folder) - 1
      folderSeats.set(folder, seat)
    }
    return seat
  }
  const packed: PackedCardOptions = {
    folders,
    options: options.map(({ values, ...summary }) => ({ ...summary, values: values.map((value) => packValue(value, seatOfFolder)) })),
  }
  packedBySummaries.set(options, packed)
  return packed
}

// And the same in reverse, for the same reason: every render of an island asks
// for the list again, and must be given the very list it was given last time.
const unpackedByPacked = new WeakMap<PackedCardOptions, CardOptionSummary[]>()

export function unpackCardOptions(packed: PackedCardOptions): CardOptionSummary[] {
  const remembered = unpackedByPacked.get(packed)
  if (remembered) return remembered
  const options = packed.options.map(({ values, ...summary }) => ({
    ...summary,
    values: values.map(([label, swatch, vi]) => ({ label, swatch: unpackSwatch(swatch, packed.folders), vi })),
  }))
  unpackedByPacked.set(packed, options)
  return options
}
