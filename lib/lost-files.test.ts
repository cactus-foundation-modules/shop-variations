import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearLostFileCache, fileUrlsFromValue, findMissingUrls } from '@/modules/shop-variations/lib/lost-files'

// signAssetUrl reads SESSION_SECRET and the media Worker url; neither matters to
// what is being tested here (which urls come back as missing), so it is stubbed
// to hand the url straight back.
vi.mock('@/lib/media/asset-token', () => ({ signAssetUrl: (url: string) => url }))

const realFetch = globalThis.fetch

function respondWith(byUrl: Record<string, number>, calls?: Array<{ url: string; method: string }>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls?.push({ url, method: init?.method ?? 'GET' })
    const status = byUrl[url]
    if (status === undefined) throw new Error('network down')
    return { status, ok: status < 400 } as Response
  }) as typeof fetch
}

beforeEach(() => clearLostFileCache())
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks() })

describe('fileUrlsFromValue', () => {
  it('splits the pipe-separated cell a file column stores', () => {
    expect(fileUrlsFromValue('https://cdn/a.glb | https://cdn/b.glb')).toEqual(['https://cdn/a.glb', 'https://cdn/b.glb'])
  })

  it('drops anything that is not an absolute http url', () => {
    // A plain attribute label, a relative path, an empty cell: none of them are
    // files this can ask about, and none of them are broken links either.
    expect(fileUrlsFromValue('Black / White')).toEqual([])
    expect(fileUrlsFromValue('/media/shop/desk.webp')).toEqual([])
    expect(fileUrlsFromValue('')).toEqual([])
    expect(fileUrlsFromValue(undefined)).toEqual([])
  })
})

describe('findMissingUrls', () => {
  it('reports a 404 and a 410 as missing, and leaves a live file alone', async () => {
    respondWith({
      'https://cdn/gone.webp': 404,
      'https://cdn/deleted.webp': 410,
      'https://cdn/here.webp': 200,
    })
    const scan = await findMissingUrls(['https://cdn/gone.webp', 'https://cdn/deleted.webp', 'https://cdn/here.webp'])
    expect([...scan.missing].sort()).toEqual(['https://cdn/deleted.webp', 'https://cdn/gone.webp'])
    expect(scan.complete).toBe(true)
  })

  it('treats an unanswerable url as fine rather than broken', async () => {
    // A timeout, a refused connection or a 500 says nothing about whether the
    // file is there. Flagging on it would point the owner at working photography.
    respondWith({ 'https://cdn/flaky.webp': 500 })
    expect((await findMissingUrls(['https://cdn/flaky.webp'])).missing).toEqual(new Set())
    clearLostFileCache()
    respondWith({})
    expect((await findMissingUrls(['https://cdn/unreachable.webp'])).missing).toEqual(new Set())
  })

  it('re-asks with a ranged GET when HEAD is refused, and judges by that', async () => {
    const calls: Array<{ url: string; method: string }> = []
    let head = true
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' })
      if (head) { head = false; return { status: 405, ok: false } as Response }
      return { status: 404, ok: false } as Response
    }) as typeof fetch

    expect((await findMissingUrls(['https://cdn/head-hostile.glb'])).missing).toEqual(new Set(['https://cdn/head-hostile.glb']))
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET'])
  })

  it('stops asking a host for HEAD once it has refused one', async () => {
    // The media Worker answers every HEAD with 405 whatever the file's state, so
    // paying for that refusal per url doubled a whole catalogue's sweep - which
    // is what pushed the "Lost image" filter past the route's time limit.
    const calls: Array<{ url: string; method: string }> = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url: String(input), method })
      return (method === 'HEAD' ? { status: 405, ok: false } : { status: 404, ok: false }) as Response
    }) as typeof fetch

    // One at a time, so the first url's refusal is known before the second starts.
    await findMissingUrls(['https://cdn/a.webp'])
    await findMissingUrls(['https://cdn/b.webp'])
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET', 'GET'])

    // A different host has said nothing yet, so it still gets asked properly.
    await findMissingUrls(['https://other/c.webp'])
    expect(calls.filter((c) => c.method === 'HEAD')).toHaveLength(2)
  })

  it('gives up at the deadline and says the scan was partial', async () => {
    respondWith({ 'https://cdn/slow.webp': 404 })
    const scan = await findMissingUrls(['https://cdn/slow.webp'], 0)
    expect(scan.complete).toBe(false)
    expect(scan.missing).toEqual(new Set())
  })

  it('asks once per url however many variations share it, and caches the answer', async () => {
    const calls: Array<{ url: string; method: string }> = []
    respondWith({ 'https://cdn/shared.webp': 404 }, calls)
    const urls = ['https://cdn/shared.webp', 'https://cdn/shared.webp', 'https://cdn/shared.webp']
    expect((await findMissingUrls(urls)).missing).toEqual(new Set(['https://cdn/shared.webp']))
    expect((await findMissingUrls(urls)).missing).toEqual(new Set(['https://cdn/shared.webp']))
    expect(calls).toHaveLength(1)
  })

  it('never asks about a url it could not check anyway', async () => {
    const calls: Array<{ url: string; method: string }> = []
    respondWith({}, calls)
    expect((await findMissingUrls(['/media/shop/desk.webp', 'not a url'])).missing).toEqual(new Set())
    expect(calls).toHaveLength(0)
  })
})
