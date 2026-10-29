import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import {
  connectionUri,
  createTestDatabase,
  createTestRole,
  dropStaleTestObjects,
  dropTestDatabase,
  dropTestRole,
  testServerFromEnv,
  type TestRole,
  type TestServer,
} from '@/lib/backup/test-database'

// The per-photo gallery slots (migration 020), against a real Postgres.
//
// Everything here is raw SQL - an int[] parameter with NULL elements, and an
// UPDATE that carries one array across to a new one by looking each URL up in
// the OLD value of another column. Both typecheck whatever they say, and the
// second only works because Postgres hands every SET expression the row as it
// was before the update. If it ever did not, ticking a photo on the Variations
// tab would scramble every slot the owner had dragged into place.
//
// Gated the same way the ledger and backup suites are: it needs the OVH server.
// The databases it makes are named cactus_rt_* and dropped afterwards; nothing
// else on that server is ever named, opened or altered.
const ENABLED = process.env.RUN_LEDGER_GUARDS === '1' || process.env.RUN_BACKUP_ROUNDTRIP === '1'
if (ENABLED) {
  try {
    ;(process as unknown as { loadEnvFile: (path: string) => void }).loadEnvFile('.env')
  } catch {
    // No .env - testServerFromEnv below fails the suite loudly rather than here.
  }
}
const suite = ENABLED ? describe : describe.skip

suite('variation gallery slots, against a real database', () => {
  let server: TestServer
  let role: TestRole
  let client: Client
  const databaseName = `cactus_rt_svrgal_${process.pid}`
  const roleName = `cactus_rt_role_svrgal_${process.pid}`

  // Imported after DATABASE_URL is set, because lib/db/prisma reads it when the
  // client is built.
  let variants: typeof import('./variants')

  beforeAll(async () => {
    server = testServerFromEnv()
    await dropStaleTestObjects(server)
    role = await createTestRole(server, roleName)
    await createTestDatabase(server, databaseName, role)

    const uri = connectionUri(server, databaseName, role)
    client = new Client({ connectionString: `${uri}&uselibpqcompat=true` })
    await client.connect()
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')

    const coreInit = join(process.cwd(), 'prisma', 'migrations', '20260626000000_init', 'migration.sql')
    await client.query(readFileSync(coreInit, 'utf8'))
    // Shop's tables first: the variations module hangs off shp_products.
    for (const dir of [join(process.cwd(), 'modules', 'shop', 'migrations'), join(__dirname, '..', '..', 'migrations')]) {
      for (const file of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
        await client.query(readFileSync(join(dir, file), 'utf8'))
      }
    }

    process.env.DATABASE_URL = uri
    variants = await import('./variants')

    await client.query(`
      INSERT INTO "shp_products" ("id","name","slug","type","price","status") VALUES
        ('parent','Volta','volta','PHYSICAL','100.00','ACTIVE'),
        ('child-a','Volta A','volta-a','PHYSICAL','100.00','ACTIVE'),
        ('child-b','Volta B','volta-b','PHYSICAL','100.00','ACTIVE')
    `)
    await client.query(`
      INSERT INTO "svr_variants" ("id","product_id","child_product_id","show_image_in_gallery","position") VALUES
        ('var-a','parent','child-a',true,0),
        ('var-b','parent','child-b',true,1)
    `)
  }, 300_000)

  afterAll(async () => {
    await import('@/lib/db/prisma')
      .then((module) => module.prisma.$disconnect())
      .catch(() => undefined)
    await client?.end().catch(() => undefined)
    if (server) {
      await dropTestDatabase(server, databaseName).catch(() => undefined)
      await dropTestRole(server, roleName).catch(() => undefined)
    }
  }, 120_000)

  const read = async (id: string) => (await variants.getVariants('parent')).find((v) => v.id === id)!

  it('reads an unarranged variation as having no per-photo slots', async () => {
    expect((await read('var-a')).galleryImagePositions).toBeNull()
  })

  it('stores an arrangement photo by photo, NULL elements included', async () => {
    await variants.setVariantGalleryArrangements([
      { id: 'var-a', imageUrls: ['a1.webp', 'a2.webp'], imagePositions: [0, 2] },
      { id: 'var-b', imageUrls: ['b1.webp', 'b2.webp'], imagePositions: [1, null] },
    ])
    const a = await read('var-a')
    expect(a.galleryImageUrls).toEqual(['a1.webp', 'a2.webp'])
    expect(a.galleryImagePositions).toEqual([0, 2])
    expect(a.galleryPosition).toBe(0)
    const b = await read('var-b')
    expect(b.galleryImagePositions).toEqual([1, null])
    expect(b.galleryPosition).toBe(1)
  })

  it('carries each slot across by URL when the pick changes', async () => {
    await variants.setVariantGalleryImageUrls('var-a', ['a3.webp', 'a2.webp'])
    const a = await read('var-a')
    expect(a.galleryImageUrls).toEqual(['a3.webp', 'a2.webp'])
    expect(a.galleryImagePositions).toEqual([null, 2])
  })

  it('drops the slots when the pick goes back to the first photo', async () => {
    await variants.setVariantGalleryImageUrls('var-a', [])
    const a = await read('var-a')
    expect(a.galleryImageUrls).toBeNull()
    expect(a.galleryImagePositions).toBeNull()
  })

  it('clears per-photo slots when a block slot is written', async () => {
    await variants.setVariantGalleryPositions([{ id: 'var-b', galleryPosition: 3 }])
    const b = await read('var-b')
    expect(b.galleryPosition).toBe(3)
    expect(b.galleryImagePositions).toBeNull()
    expect(b.galleryImageUrls).toEqual(['b1.webp', 'b2.webp'])
  })
})
