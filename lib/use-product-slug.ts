'use client'

import { useEffect, useState } from 'react'

// The variations blocks live on the shop product page (/shop/products/<slug>).
// Rather than have shop inject product context into our block types, we read the
// slug straight from the URL - keeping every scrap of variations knowledge out
// of the shop module. In the Puck editor canvas there's no product URL, so this
// returns null and blocks render a labelled preview.
export function productSlugFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  const i = parts.indexOf('products')
  // Shop's ROOT product URL style serves the product page at a bare top-level
  // slug, so a single-segment path is the slug candidate there. A bare segment
  // that is not a product (an info page) simply matches no product - the same
  // harmless miss as any malformed path below.
  const next = i >= 0 ? parts[i + 1] : parts.length === 1 ? parts[0] : undefined
  if (!next) return null
  // A malformed escape in the path ("/shop/products/%") makes decodeURIComponent
  // throw, and thrown from here it took the whole variations block down on a
  // public product page. The raw segment simply matches no product instead.
  try {
    return decodeURIComponent(next)
  } catch {
    return next
  }
}

// An explicit slug (resolved server-side and passed down by an RSC block half)
// is used as-is on the first render, so the server's HTML already carries the
// real controls. Only when there isn't one do we fall back to reading the URL
// after mount - which costs a render, and is why the explicit path exists.
export function useProductSlug(explicit?: string | null): string | null {
  const [slug, setSlug] = useState<string | null>(explicit ?? null)
  useEffect(() => {
    if (explicit) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window is only readable after mount; deriving the slug from the URL must happen here to avoid a hydration mismatch
    setSlug(productSlugFromPath(window.location.pathname))
  }, [explicit])
  return explicit ?? slug
}
