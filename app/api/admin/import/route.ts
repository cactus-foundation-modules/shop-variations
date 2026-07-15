import { NextRequest, NextResponse } from 'next/server'
import { requireShopUser } from '@/modules/shop/lib/access'
import { importVariationsCsv } from '@/modules/shop-variations/lib/csv'

// Accepts a CSV (multipart file or raw text body) and creates/updates the
// options and hidden child products it describes, reporting per-row errors like
// shop's own importer.
export async function POST(request: NextRequest) {
  const gate = await requireShopUser('shop.products')
  if (gate.error) return gate.error

  let text: string
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    text = await file.text()
  } else {
    text = await request.text()
  }
  if (!text.trim()) return NextResponse.json({ error: 'The file is empty' }, { status: 400 })

  const result = await importVariationsCsv(text)
  return NextResponse.json(result)
}
