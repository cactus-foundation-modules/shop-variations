// How the product page's variation payload travels from the server to the
// browser.
//
// The RSC halves resolve the whole selector payload while the page renders and
// hand it to the storefront islands as a prop, so the options, the price and the
// chosen combination's photographs are in the first HTML (see
// variation-bootstrap.ts). That prop is right - every field of it is read by
// something - but the spelled-out version is enormous, because nearly every byte
// of it repeats.
//
// Measured on deskwell.co.uk's Air standing desk, September 2026: 480 variations,
// and the prop was 1.0 MB of flight payload the browser must parse before the
// page is interactive. Almost all of it (993 KB) was the variations: 1,302
// photographs, each written out in full with the same 150-character folder in
// front, a 300px copy whose address is that same folder again plus "thumb/" and
// the same file name, and a description repeated once per photograph. Six option
// value uuids per variation, where a small number says the same thing. A
// "returnable": "$undefined" on every single one.
//
// So the wire shape names each repeated part once and points at it:
//
//   - the variations become columns (every id, every child id, every price)
//     rather than 480 objects each spelling out 23 key names;
//   - a field that is nearly always the same (enabled, in stock, promoted, a
//     minimum of one) travels only for the variations where it is not;
//   - a variation's option values are seats in the options' own values, which
//     the payload already carries in `options`;
//   - a photograph is its folder's seat, its file name, the part of its 300px
//     copy's address that cannot be worked out from the photograph's own, and
//     its description's seat;
//   - the descriptions are written once each, front-coded - each one says how
//     much it shares with the one before and spells out only the rest, which on
//     a range named "Desk - 120cm / 60cm / Beech / Black" then "... / Silver" is
//     nearly all of it.
//
// Unpacked once in the browser, at the island boundary (use-variation-selection
// does it on the way into the store), and every line after that works on the
// VariantSelectorPayload it always did. The public variations API route still
// answers with the spelled-out payload: this shape is for the RSC prop alone.
//
// Lossless by construction, and the tests hold it to that: every string is
// rebuilt by concatenation, a derived address is only ever used where rebuilding
// it gives back exactly the original, and anything that does not fit the common
// case is carried verbatim. Two corners are normalised rather than kept, and both
// read identically to every consumer: an optional key that was absent or
// explicitly undefined comes back absent, and `returnable`/`returnsDiscretionary`
// always come back as keys, holding undefined where they were withheld - the
// shape getVariantSelectorPayload itself builds for a shopper.
//
// Client-safe: types, core's rendition naming constants, nothing else.
import { RENDITION_FOLDER_NAME } from '@/lib/media/rendition-naming'
import { THUMB_RENDITION_SUFFIX } from '@/lib/media/thumb-renditions'
import type { SvrOptionWithValues, VariantSelectorPayload, VariantSelectorVariant, VariationBootstrap } from '@/modules/shop-variations/lib/types'

/**
 * A table entry written against the entry before it: spelled out in full, or as
 * how many leading characters it shares with that entry plus the rest.
 */
export type FrontCodedString = string | [sharedLength: number, rest: string]

/**
 * Where one photograph's 300px copy is.
 *  - a string: filed where core files renditions, so the address is
 *    `<photo folder>thumb/<this string><photo file stem>-thumb.webp`. The string is
 *    whatever sits between - on a media-library upload, the storage key's nanoid.
 *  - null: the empty string, which means no copy is on file.
 *  - a pair: anywhere else, spelled out as a folder seat and a file name.
 */
export type PackedThumb = string | null | [folder: number, file: string]

/** One photograph: its folder's seat, its file name, its 300px copy, its description's seat. */
export type PackedPicture = [folder: number, file: string, thumb: PackedThumb, alt: number]

/**
 * A variation whose three picture lists do not line up one-to-one. The server
 * never builds one (it keeps them index-aligned on purpose), but the type allows
 * it, so it is carried verbatim rather than squeezed into a shape it does not fit.
 */
export type UnalignedPictures = { urls: string[]; thumbs: string[]; alts: string[] }

/** `[variation index, value]` for each variation whose value is not the column's usual one. */
export type SparseColumn<Value> = Array<[variation: number, value: Value]>

// The optional keys whose absence is recorded, so they come back absent. Every
// one of them has a reader that treats "absent" differently from the value a
// column would otherwise restore - a missing minimum falls back to the parent's,
// a missing tracksStock is inferred from the stock count - so absence has to
// survive the trip. `returnable` and `returnsDiscretionary` are not here: their
// column's usual value already IS undefined.
const RECORDED_OPTIONAL_KEYS = [
  'aliasValueIds',
  'retailPrice',
  'tracksStock',
  'imageThumbUrls',
  'imageAlts',
  'showImageInGallery',
  'showModelInGallery',
  'galleryPosition',
  'saleSku',
  'minOrderQuantity',
] as const satisfies ReadonlyArray<keyof VariantSelectorVariant>

export type RecordedOptionalVariantKey = (typeof RECORDED_OPTIONAL_KEYS)[number]

export type PackedSelectorVariants = {
  // One entry per variation, in matrix order. Its length is the variation count
  // every full column below shares.
  ids: string[]
  childProductIds: string[]
  // Each variation's option value ids, in the order it carries them, as seats in
  // the payload's own option values (every value of every option, in display
  // order) followed by `strayValueIds`.
  optionValueSeats: number[][]
  // Ids a variation carries that no option lists - a value deleted from under a
  // variation, say. Absent on every healthy product.
  strayValueIds?: string[]
  aliasValueSeats?: SparseColumn<number[]>
  prices: number[]
  compareAtPrices?: SparseColumn<number>
  // Full rather than sparse: where a shop shows RRPs at all, very nearly every
  // variation carries one. Absent when none does.
  retailPrices?: Array<number | null>
  enabled?: SparseColumn<boolean>
  inStock?: SparseColumn<boolean>
  stockCounts?: SparseColumn<number>
  // Usually true: a product with options is the kind whose stock is counted per
  // combination, which is what `inStock` is worked out from.
  tracksStock?: SparseColumn<boolean>
  returnable?: SparseColumn<boolean>
  returnsDiscretionary?: SparseColumn<boolean>
  showImageInGallery?: SparseColumn<boolean>
  showModelInGallery?: SparseColumn<boolean>
  galleryPositions?: SparseColumn<number>
  skus?: SparseColumn<string>
  saleSkus?: SparseColumn<string>
  suppliers?: SparseColumn<string>
  minOrderQuantities?: SparseColumn<number>
  absentKeys?: SparseColumn<RecordedOptionalVariantKey[]>
  // Folder prefixes, each INCLUDING its trailing slash.
  folders: string[]
  // Distinct photograph descriptions, front-coded in the order first met.
  alts: FrontCodedString[]
  pictures: Array<PackedPicture[] | UnalignedPictures>
}

export type PackedVariationBootstrap = {
  currencySymbol: string
  preselectOptionValueIds?: string[]
  // The payload exactly as built, less its variations, which travel beside it.
  payload: Omit<VariantSelectorPayload, 'variants'>
  variants: PackedSelectorVariants
}

// A front-coded entry costs a few bytes of framing, so sharing only pays past
// this many characters. Correctness does not depend on the figure.
const FRONT_CODE_MIN_SHARED = 8

const THUMB_FOLDER = `${RENDITION_FOLDER_NAME}/`
const THUMB_TAIL = `-${THUMB_RENDITION_SUFFIX}.webp`

// The same rule core applies when it names a rendition after its original (see
// renditionFileName in lib/media/rendition-naming.ts): the last extension goes.
function fileStem(file: string): string {
  return file.replace(/\.[a-z0-9]+$/i, '')
}

// Split at the LAST slash, keeping the slash on the folder, so a url with no
// slash at all interns the empty folder and rejoins to exactly itself.
function splitAtLastSlash(url: string): [folder: string, file: string] {
  const cut = url.lastIndexOf('/') + 1
  return [url.slice(0, cut), url.slice(cut)]
}

type StringTable = { entries: string[]; seatOf: (value: string) => number }

function createStringTable(): StringTable {
  const entries: string[] = []
  const seats = new Map<string, number>()
  return {
    entries,
    seatOf(value) {
      let seat = seats.get(value)
      if (seat === undefined) {
        seat = entries.push(value) - 1
        seats.set(value, seat)
      }
      return seat
    },
  }
}

export function frontCodeStrings(table: string[]): FrontCodedString[] {
  let previous = ''
  return table.map((entry) => {
    const limit = Math.min(entry.length, previous.length)
    let shared = 0
    while (shared < limit && entry.charCodeAt(shared) === previous.charCodeAt(shared)) shared++
    // Never cut between the two halves of a surrogate pair: the pieces would
    // still rejoin, but a lone half is not a string anybody should be handed.
    if (shared > 0 && shared < entry.length) {
      const lastShared = entry.charCodeAt(shared - 1)
      if (lastShared >= 0xd800 && lastShared <= 0xdbff) shared--
    }
    previous = entry
    return shared >= FRONT_CODE_MIN_SHARED ? [shared, entry.slice(shared)] : entry
  })
}

export function unfrontCodeStrings(coded: FrontCodedString[]): string[] {
  const out: string[] = []
  let previous = ''
  for (const entry of coded) {
    const value = typeof entry === 'string' ? entry : previous.slice(0, entry[0]) + entry[1]
    out.push(value)
    previous = value
  }
  return out
}

function collectSparse<Value>(
  variants: VariantSelectorVariant[],
  read: (variant: VariantSelectorVariant) => Value | undefined,
  isUsual: (value: Value) => boolean,
): SparseColumn<Value> | undefined {
  const entries: SparseColumn<Value> = []
  variants.forEach((variant, index) => {
    const value = read(variant)
    if (value !== undefined && !isUsual(value)) entries.push([index, value])
  })
  return entries.length > 0 ? entries : undefined
}

// The same, for a column whose usual value is null: only the variations that
// carry something are written.
function collectPresent<Value>(
  variants: VariantSelectorVariant[],
  read: (variant: VariantSelectorVariant) => Value | null | undefined,
): SparseColumn<Value> | undefined {
  const entries: SparseColumn<Value> = []
  variants.forEach((variant, index) => {
    const value = read(variant)
    if (value !== undefined && value !== null) entries.push([index, value])
  })
  return entries.length > 0 ? entries : undefined
}

function spreadSparse<Value>(column: SparseColumn<Value> | undefined, count: number, usual: Value): Value[] {
  const out = new Array<Value>(count).fill(usual)
  for (const [index, value] of column ?? []) out[index] = value
  return out
}

function packThumb(folder: string, file: string, thumb: string, folders: StringTable): PackedThumb {
  if (thumb === '') return null
  const prefix = folder + THUMB_FOLDER
  const tail = fileStem(file) + THUMB_TAIL
  // The length check keeps prefix and tail from overlapping, so the middle taken
  // here rebuilds to exactly `thumb` and nothing else.
  if (thumb.length >= prefix.length + tail.length && thumb.startsWith(prefix) && thumb.endsWith(tail)) {
    return thumb.slice(prefix.length, thumb.length - tail.length)
  }
  const [thumbFolder, thumbFile] = splitAtLastSlash(thumb)
  return [folders.seatOf(thumbFolder), thumbFile]
}

function unpackThumb(folder: string, file: string, thumb: PackedThumb, folders: string[]): string {
  if (thumb === null) return ''
  if (typeof thumb === 'string') return folder + THUMB_FOLDER + thumb + fileStem(file) + THUMB_TAIL
  return (folders[thumb[0]] ?? '') + thumb[1]
}

function packPictures(variant: VariantSelectorVariant, folders: StringTable, alts: StringTable): PackedPicture[] | UnalignedPictures {
  const urls = variant.imageUrls
  const thumbs = variant.imageThumbUrls ?? []
  const altTexts = variant.imageAlts ?? []
  if (thumbs.length !== urls.length || altTexts.length !== urls.length) {
    return { urls, thumbs, alts: altTexts }
  }
  return urls.map((url, index) => {
    const [folder, file] = splitAtLastSlash(url)
    return [folders.seatOf(folder), file, packThumb(folder, file, thumbs[index] ?? '', folders), alts.seatOf(altTexts[index] ?? '')]
  })
}

type UnpackedPictures = Pick<VariantSelectorVariant, 'imageUrls'> & { imageThumbUrls: string[]; imageAlts: string[] }

function unpackPictures(entry: PackedPicture[] | UnalignedPictures | undefined, folders: string[], alts: string[]): UnpackedPictures {
  if (entry === undefined) return { imageUrls: [], imageThumbUrls: [], imageAlts: [] }
  if (!Array.isArray(entry)) return { imageUrls: entry.urls, imageThumbUrls: entry.thumbs, imageAlts: entry.alts }
  const imageUrls: string[] = []
  const imageThumbUrls: string[] = []
  const imageAlts: string[] = []
  for (const [folderSeat, file, thumb, altSeat] of entry) {
    const folder = folders[folderSeat] ?? ''
    imageUrls.push(folder + file)
    imageThumbUrls.push(unpackThumb(folder, file, thumb, folders))
    imageAlts.push(alts[altSeat] ?? '')
  }
  return { imageUrls, imageThumbUrls, imageAlts }
}

// Leaves out every key whose value is undefined. A key set to undefined still
// crosses the RSC boundary, as `"key":"$undefined"`, which is exactly the kind of
// weight this file exists to stop carrying.
function definedOnly<Fields extends object>(fields: Fields): Partial<Fields> {
  const out: Partial<Fields> = {}
  for (const key of Object.keys(fields) as Array<keyof Fields>) {
    if (fields[key] !== undefined) out[key] = fields[key]
  }
  return out
}

export function packSelectorVariants(variants: VariantSelectorVariant[], options: SvrOptionWithValues[]): PackedSelectorVariants {
  const valueSeats = new Map<string, number>()
  for (const option of options) {
    for (const value of option.values) if (!valueSeats.has(value.id)) valueSeats.set(value.id, valueSeats.size)
  }
  const strayValueIds: string[] = []
  const seatOfValue = (valueId: string): number => {
    let seat = valueSeats.get(valueId)
    if (seat === undefined) {
      seat = valueSeats.size
      valueSeats.set(valueId, seat)
      strayValueIds.push(valueId)
    }
    return seat
  }

  const folders = createStringTable()
  const alts = createStringTable()
  const optionValueSeats = variants.map((variant) => variant.optionValueIds.map(seatOfValue))
  const aliasValueSeats = collectSparse(variants, (variant) => variant.aliasValueIds?.map(seatOfValue), (seats) => seats.length === 0)
  const pictures = variants.map((variant) => packPictures(variant, folders, alts))
  const retailPrices = variants.map((variant) => variant.retailPrice ?? null)

  return {
    ids: variants.map((variant) => variant.id),
    childProductIds: variants.map((variant) => variant.childProductId),
    optionValueSeats,
    prices: variants.map((variant) => variant.price),
    folders: folders.entries,
    alts: frontCodeStrings(alts.entries),
    pictures,
    // Each optional column is only written when it has something to say, so a
    // shopper's copy of a plain range carries none of them.
    ...definedOnly({
      strayValueIds: strayValueIds.length > 0 ? strayValueIds : undefined,
      aliasValueSeats,
      compareAtPrices: collectPresent(variants, (variant) => variant.compareAtPrice),
      retailPrices: retailPrices.some((value) => value !== null) ? retailPrices : undefined,
      enabled: collectSparse(variants, (variant) => variant.enabled, (value) => value === true),
      inStock: collectSparse(variants, (variant) => variant.inStock, (value) => value === true),
      stockCounts: collectPresent(variants, (variant) => variant.stockCount),
      tracksStock: collectSparse(variants, (variant) => variant.tracksStock, (value) => value === true),
      // Staff-only, and every figure a member of staff is sent is a real answer,
      // so none of them is "usual": all are written, and a shopper's (withheld,
      // undefined) are not.
      returnable: collectSparse(variants, (variant) => variant.returnable, () => false),
      returnsDiscretionary: collectSparse(variants, (variant) => variant.returnsDiscretionary, () => false),
      showImageInGallery: collectSparse(variants, (variant) => variant.showImageInGallery, (value) => value === false),
      showModelInGallery: collectSparse(variants, (variant) => variant.showModelInGallery, (value) => value === false),
      galleryPositions: collectPresent(variants, (variant) => variant.galleryPosition),
      skus: collectPresent(variants, (variant) => variant.sku),
      saleSkus: collectPresent(variants, (variant) => variant.saleSku),
      suppliers: collectPresent(variants, (variant) => variant.supplier),
      minOrderQuantities: collectSparse(variants, (variant) => variant.minOrderQuantity, (value) => value === 1),
      absentKeys: collectSparse(
        variants,
        (variant) => RECORDED_OPTIONAL_KEYS.filter((key) => variant[key] === undefined),
        (keys) => keys.length === 0,
      ),
    }),
  }
}

export function unpackSelectorVariants(packed: PackedSelectorVariants, options: SvrOptionWithValues[]): VariantSelectorVariant[] {
  const count = packed.ids.length
  const valueIds = [...options.flatMap((option) => option.values.map((value) => value.id)), ...(packed.strayValueIds ?? [])]
  // The seat table is built the way the packer built it: the first time an id
  // appears is the seat it holds, so an id listed under two options reads back
  // as itself either way.
  const idAtSeat: string[] = []
  const seen = new Set<string>()
  for (const id of valueIds) {
    if (seen.has(id)) continue
    seen.add(id)
    idAtSeat.push(id)
  }
  const valueIdsOf = (seats: number[]): string[] => seats.map((seat) => idAtSeat[seat] ?? '')

  const aliasSeats = spreadSparse<number[]>(packed.aliasValueSeats, count, [])
  const compareAtPrices = spreadSparse<number | null>(packed.compareAtPrices, count, null)
  const enabled = spreadSparse(packed.enabled, count, true)
  const inStock = spreadSparse(packed.inStock, count, true)
  const stockCounts = spreadSparse<number | null>(packed.stockCounts, count, null)
  const tracksStock = spreadSparse(packed.tracksStock, count, true)
  const returnable = spreadSparse<boolean | undefined>(packed.returnable, count, undefined)
  const returnsDiscretionary = spreadSparse<boolean | undefined>(packed.returnsDiscretionary, count, undefined)
  const showImageInGallery = spreadSparse(packed.showImageInGallery, count, false)
  const showModelInGallery = spreadSparse(packed.showModelInGallery, count, false)
  const galleryPositions = spreadSparse<number | null>(packed.galleryPositions, count, null)
  const skus = spreadSparse<string | null>(packed.skus, count, null)
  const saleSkus = spreadSparse<string | null>(packed.saleSkus, count, null)
  const suppliers = spreadSparse<string | null>(packed.suppliers, count, null)
  const minOrderQuantities = spreadSparse(packed.minOrderQuantities, count, 1)
  const absentKeys = spreadSparse<RecordedOptionalVariantKey[]>(packed.absentKeys, count, [])
  const alts = unfrontCodeStrings(packed.alts)

  return packed.ids.map((id, index) => {
    const pictures = unpackPictures(packed.pictures[index], packed.folders, alts)
    // Keys in the order getVariantSelectorPayload writes them, so a variation
    // read back looks like one built on the server when somebody logs it.
    const variant: VariantSelectorVariant = {
      id,
      childProductId: packed.childProductIds[index] ?? '',
      optionValueIds: valueIdsOf(packed.optionValueSeats[index] ?? []),
      aliasValueIds: valueIdsOf(aliasSeats[index] ?? []),
      enabled: enabled[index] ?? true,
      price: packed.prices[index] ?? 0,
      compareAtPrice: compareAtPrices[index] ?? null,
      retailPrice: packed.retailPrices?.[index] ?? null,
      inStock: inStock[index] ?? true,
      stockCount: stockCounts[index] ?? null,
      tracksStock: tracksStock[index] ?? true,
      imageUrls: pictures.imageUrls,
      imageThumbUrls: pictures.imageThumbUrls,
      imageAlts: pictures.imageAlts,
      showImageInGallery: showImageInGallery[index] ?? false,
      showModelInGallery: showModelInGallery[index] ?? false,
      galleryPosition: galleryPositions[index] ?? null,
      sku: skus[index] ?? null,
      saleSku: saleSkus[index] ?? null,
      supplier: suppliers[index] ?? null,
      minOrderQuantity: minOrderQuantities[index] ?? 1,
      returnable: returnable[index],
      returnsDiscretionary: returnsDiscretionary[index],
    }
    for (const key of absentKeys[index] ?? []) delete variant[key]
    return variant
  })
}

export function packVariationBootstrap(bootstrap: VariationBootstrap): PackedVariationBootstrap {
  const { variants, ...payloadWithoutVariants } = bootstrap.payload
  return {
    currencySymbol: bootstrap.currencySymbol,
    ...(bootstrap.preselectOptionValueIds !== undefined ? { preselectOptionValueIds: bootstrap.preselectOptionValueIds } : {}),
    payload: payloadWithoutVariants,
    variants: packSelectorVariants(variants, payloadWithoutVariants.options),
  }
}

// Every island on a product page is handed the same packed object (the flight
// payload writes it once and points the rest at it), and each asks for it
// unpacked on the server render as well as in the browser - so the answer is kept
// against the object itself. Weakly: the entry goes when the page's props do, and
// since the key is one render's own object, one shopper's payload can never be
// handed to another's.
const unpackedByPacked = new WeakMap<PackedVariationBootstrap, VariationBootstrap>()

export function unpackVariationBootstrap(packed: PackedVariationBootstrap): VariationBootstrap {
  const remembered = unpackedByPacked.get(packed)
  if (remembered) return remembered
  const unpacked: VariationBootstrap = {
    payload: { ...packed.payload, variants: unpackSelectorVariants(packed.variants, packed.payload.options) },
    currencySymbol: packed.currencySymbol,
    ...(packed.preselectOptionValueIds !== undefined ? { preselectOptionValueIds: packed.preselectOptionValueIds } : {}),
  }
  unpackedByPacked.set(packed, unpacked)
  return unpacked
}
