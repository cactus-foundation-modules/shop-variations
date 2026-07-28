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
//   - Requests run a dozen at a time. The whole catalogue's images can be
//     several hundred urls and the route this runs inside has a 60s ceiling.

const CACHE_TTL_MS = 5 * 60 * 1000
const CONCURRENCY = 12
const TIMEOUT_MS = 6_000

/** Statuses that mean the file genuinely is not there. Everything else is noise. */
const MISSING_STATUSES = new Set([404, 410])

const cache = new Map<string, { missing: boolean; at: number }>()

/** Test seam: forget every cached verdict. */
export function clearLostFileCache(): void {
  cache.clear()
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

  const status = await ask('HEAD')
  if (status === null) return false
  if (MISSING_STATUSES.has(status)) return true
  // Some object stores answer HEAD with 403/405 whatever the object's state, so
  // one of those is not an answer - ask again with a ranged GET before judging.
  if (status === 403 || status === 405 || status === 501) {
    const retry = await ask('GET')
    return retry !== null && MISSING_STATUSES.has(retry)
  }
  return false
}

/**
 * The subset of `urls` that are known to be missing. Deduplicated, cached, and
 * checked a few at a time. A url this cannot get a straight answer about is left
 * out: the filter under-reports rather than accusing a working file.
 */
export async function findMissingUrls(urls: Iterable<string>): Promise<Set<string>> {
  const now = Date.now()
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
      const gone = await isMissing(url)
      cache.set(url, { missing: gone, at: Date.now() })
      if (gone) missing.add(url)
    }
  })
  await Promise.all(workers)

  return missing
}
