// Move an established shop's variant pictures into each product's `variations`
// folder, from a terminal.
//
//   export DATABASE_URL=... DIRECT_URL=...   # plus the storage provider's own vars
//   npx tsx --tsconfig tsconfig.json modules/shop-variations/scripts/backfill-variation-folders.mts --dry-run
//   npx tsx --tsconfig tsconfig.json modules/shop-variations/scripts/backfill-variation-folders.mts
//
// Run from the REPO ROOT, not from the module folder - the `@/` paths resolve
// against the root tsconfig.
//
// Variant pictures used to be filed in among the parent product's own
// photographs. That reads well enough for a product with two variants and not at
// all for one with two hundred - 26,054 of the 28,335 product pictures on the
// catalogue this was written for belong to a variant. New ones go to the
// subfolder already; this walks what is on the shelves.
//
// Each picture's small copies follow it automatically, so this leaves a
// `variations/thumb` folder behind it. Run it BEFORE core's rendition tidy-up
// (scripts/backfill-rendition-folders.mts) or the tidy-up does the same work twice.
//
// A terminal job rather than a button because every picture moved is a blob copy
// and a delete at the storage provider. Everything it does is restartable and
// idempotent: it works parent product by parent product in id order, prints the
// last one it finished, and a product already done moves nothing.
//
// Flags:
//   --dry-run       report roughly what would move and move nothing
//   --after=<id>    resume from the product id the last run reported
//   --limit=<n>     stop after n parent products (default: keep going until done)
//   --batch=<n>     parent products per pass (default 20)

import Module from 'module'

// Puck ships CSS that the shop's import graph pulls in through a require().
// Stubbed both ways - the CJS extension hook for require(), a loader hook for
// import - because which one fires depends on how far down the graph the CSS is.
type Extensions = Record<string, (m: unknown, filename: string) => void>
;(Module as unknown as { _extensions: Extensions })._extensions['.css'] = () => {}
// The hook's own url, used as-is. Round-tripping it through pathToFileURL()
// encodes the already-encoded space in "Git Local" a second time and node then
// looks for a directory called "Git%20Local".
Module.register?.(new URL('./css-stub-hook.mjs', import.meta.url).href, import.meta.url)

const args = process.argv.slice(2)
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const dryRun = args.includes('--dry-run')
const batch = Number(flag('batch') ?? 20)
const limitArg = flag('limit')
const limit = limitArg ? Number(limitArg) : Number.POSITIVE_INFINITY

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it for this run only - never write it into the repo.')
  process.exit(1)
}

// Destructured off the namespace rather than imported by name: the module lib
// compiles to CJS here and a static named import finds nothing.
const mod = await import('@/modules/shop-variations/lib/variation-media-backfill')
const countVariationImagesToRefile = mod.countVariationImagesToRefile ?? mod.default?.countVariationImagesToRefile
const refileVariationImages = mod.refileVariationImages ?? mod.default?.refileVariationImages

const pending = await countVariationImagesToRefile()
console.log(`${pending.toLocaleString()} variant pictures filed outside a variations folder.`)

if (dryRun) {
  const sample = await refileVariationImages({ limit: batch, dryRun: true })
  console.log(
    `Dry run over ${sample.productsSeen.toLocaleString()} products: ` +
    `${sample.moved.toLocaleString()} pictures in scope` +
    (sample.more ? ', and there are more products after them.' : '.'),
  )
  process.exit(0)
}

const started = Date.now()
let after: string | null = flag('after') ?? null
let products = 0
let moved = 0
let left = 0

for (;;) {
  if (products >= limit) break
  let result
  try {
    result = await refileVariationImages({ after, limit: Math.min(batch, limit - products) })
  } catch (err) {
    // A pass that throws outright has taken its whole page of products with it.
    // Say where it stopped rather than looping on it - re-running from the id
    // printed picks up exactly where this left off.
    console.error(`Pass starting after '${after ?? 'the first product'}' failed:`, err)
    break
  }
  if (result.productsSeen === 0) break
  products += result.productsSeen
  moved += result.moved
  left += result.left
  after = result.lastProductId

  const mins = (Date.now() - started) / 60000
  const rate = mins > 0 ? moved / mins : 0
  const remaining = Math.max(0, pending - moved)
  const eta = rate > 0 ? `${Math.round(remaining / rate)} min left` : 'working out the rate'
  console.log(
    `${products.toLocaleString()} products, ${moved.toLocaleString()}/${pending.toLocaleString()} pictures moved` +
    (left > 0 ? `, ${left.toLocaleString()} left where they were` : '') +
    ` - ${Math.round(rate)}/min, ${eta} - resume with --after='${after ?? ''}'`,
  )
  if (!result.more) break
}

console.log(
  `Finished: ${moved.toLocaleString()} variant pictures moved over ${products.toLocaleString()} products` +
  (left > 0 ? `, ${left.toLocaleString()} left where they were` : '') +
  `, ${Math.round((Date.now() - started) / 60000)} minutes.`,
)
console.log('Now run scripts/backfill-rendition-folders.mts to tidy the small copies of everything else.')
process.exit(0)
