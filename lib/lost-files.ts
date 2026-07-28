import { signAssetUrl } from '@/lib/media/asset-token'

// Which of a set of stored file urls no longer resolve.
//
// The cross-product Variations browser offers "lost image" and "lost <file
// column>" filters: a variation whose image or 3D file is still recorded against
// it, but whose blob has since been renamed, moved between folders or deleted
// from the media library, so the shopper gets a broken frame. Nothing in the
// database knows that has happened - the reference is a url, and a url only
// stops working when something asks for it - so the only honest check is to ask.
//
// Three things keep that affordable and safe:
//
//   - Only a missing file counts. A timeout, a DNS failure, a 500, a rate limit:
//     all read as "fine". A filter that quietly lists half the catalogue as
//     broken because the media host had a bad second is worse than useless, and
//     the owner's next move would be to delete real product photography.
//   - Results are cached for a few minutes, so paging through the results or
//     flipping between the two filters does not re-ask for every url each time.
//   - Requests run many at a time, HEAD is abandoned for a host that refuses it,
//     and the whole sweep gives up at a deadline. All three exist for the same
//     reason: a catalogue is thousands of urls and the route this runs inside
//     has a 60s ceiling, past which the filter returns nothing at all.

const CACHE_TTL_MS = 5 * 60 * 1000
// Each check is one small ranged request against a CDN, so the limit is how many
// sockets are worth holding open rather than anything the media host would
// notice. A dozen at a time could not get through a real catalogue inside the
// route's 60s ceiling, which is precisely how the filter came to look broken:
// a 4,600-image shop measured 30s at 48 and 8s at 96, against roughly three
// minutes at the original dozen-with-a-wasted-HEAD.
const CONCURRENCY = 96
const TIMEOUT_MS = 6_000
/**
 * How long the whole sweep may take. Comfortably inside the 60s ceiling on the
 * module route, leaving room for the queries either side of it. Hitting this is
 * not an error - the caller is told the scan was partial and says so.
 */
const DEFAULT_BUDGET_MS = 35_000

/** Statuses that mean the file genuinely is not there. Everything else is noise. */
const MISSING_STATUSES = new Set([404, 410])

/**
 * Statuses that mean "not that way" rather than "not there". The media Worker
 * answers every HEAD with 405 whatever the object's state, and object stores
 * commonly answer 403 - so a status like this says nothing, and the url has to
 * be asked again with a ranged GET.
 */
const HEAD_REFUSED_STATUSES = new Set([403, 405, 501])

const cache = new Map<string, { missing: boolean; at: number }>()

/**
 * Hosts that have already refused a HEAD. A refusal is a property of the host,
 * not of the file, so remembering it turns a catalogue-wide sweep from two
 * requests per url into one - the single biggest cost in the whole check.
 */
const headRefusedOrigins = new Set<string>()

/** Test seam: forget every cached verdict. */
export function clearLostFileCache(): void {
  cache.clear()
  headRefusedOrigins.clear()
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * Pull the file urls out of one contributed cell value. A file column stores a
 * pipe-separated list (a variant can carry several models); a plain absolute url
 * is the single-value case of the same thing. Anything that is not an http(s)
 * url is dropped - a relative path has no host to ask, and a hand-typed label
 * is not a file at all.
 */
export function fileUrlsFromValue(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
}

async function isMissing(url: string): Promise<boolean> {
  // Protected types (3D models) need a read token or the media Worker answers
  // 403, which would otherwise look like a broken file for every single model.
  const signed = signAssetUrl(url)
  const origin = originOf(signed)

  const ask = async (method: 'HEAD' | 'GET'): Promise<number | null> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(signed, {
        method,
        redirect: 'follow',
        cache: 'no-store',
        signal: controller.signal,
        // A one-byte range on the GET fallback: enough to learn the status
        // without pulling a 40MB model down to find out it exists.
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      })
      return res.status
    } catch {
      // Aborted, refused, DNS gone: unknown, not missing.
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  // A host that refused the last HEAD will refuse this one: skip straight to the
  // ranged GET rather than paying for the refusal once per file.
  if (!origin || !headRefusedOrigins.has(origin)) {
    const status = await ask('HEAD')
    if (status === null) return false
    if (MISSING_STATUSES.has(status)) return true
    if (!HEAD_REFUSED_STATUSES.has(status)) return false
    if (origin) headRefusedOrigins.add(origin)
  }

  const retry = await ask('GET')
  return retry !== null && MISSING_STATUSES.has(retry)
}

export type LostFileScan = {
  /** The urls known to be missing. */
  missing: Set<string>
  /** False when the deadline stopped the sweep before every url was asked about. */
  complete: boolean
}

/**
 * The subset of `urls` that are known to be missing. Deduplicated, cached, and
 * checked many at a time. A url this cannot get a straight answer about is left
 * out: the filter under-reports rather than accusing a working file.
 *
 * The sweep stops at `budgetMs` and reports itself incomplete rather than
 * running the route out of time - which the caller can say out loud, where an
 * overrun just returns an error the browser cannot explain.
 */
export async function findMissingUrls(urls: Iterable<string>, budgetMs: number = DEFAULT_BUDGET_MS): Promise<LostFileScan> {
  const now = Date.now()
  const deadline = now + budgetMs
  let complete = true
  const missing = new Set<string>()
  const toCheck: string[] = []

  for (const url of new Set(urls)) {
    if (!/^https?:\/\//i.test(url)) continue
    const hit = cache.get(url)
    if (hit && now - hit.at < CACHE_TTL_MS) {
      if (hit.missing) missing.add(url)
      continue
    }
    toCheck.push(url)
  }

  let next = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, toCheck.length) }, async () => {
    for (;;) {
      const i = next++
      const url = toCheck[i]
      if (url === undefined) return
      if (Date.now() >= deadline) { complete = false; return }
      const gone = await isMissing(url)
      cache.set(url, { missing: gone, at: Date.now() })
      if (gone) missing.add(url)
    }
  })
  await Promise.all(workers)

  return { missing, complete }
}
