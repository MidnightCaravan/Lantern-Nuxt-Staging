import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const endpoint = readFileSync(
  path.join(process.cwd(), 'server/api/studio/works/[workId]/thumbnail-direct.put.ts'),
  'utf8',
)

describe('direct thumbnail upload parity', () => {
  it('stores empty bodies like the Flask Worker instead of rejecting them', () => {
    expect(endpoint).toContain('raw === undefined || raw === null')
    expect(endpoint).toContain('? new Uint8Array()')
    expect(endpoint).not.toContain("statusMessage: 'Thumbnail file is empty.'")
  })

  it('keeps the Flask extension allowlist, key, metadata, and old-object cleanup', () => {
    expect(endpoint).toContain("png:'image/png'")
    expect(endpoint).toContain('uploads/covers/${workId}/cover.${extension}')
    expect(endpoint).toContain('httpMetadata: { contentType: TYPES[extension] }')
    expect(endpoint).toContain('await bucket.delete(oldKey)')
  })

  it('deletes any changed prior /media/ cover like worker.py:1031-1042', () => {
    expect(endpoint).toContain("oldCover.startsWith('/media/')")
    expect(endpoint).not.toContain('`/media/uploads/covers/${workId}/`')
  })
})
