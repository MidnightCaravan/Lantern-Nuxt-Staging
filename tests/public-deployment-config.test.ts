import { describe, expect, it } from 'vitest'
import configHandler from '../server/api/public/config.get'
import { callHandler } from './helpers/handler'

describe('public deployment configuration', () => {
  it('defaults to staging when anonymous writes are pinned to staging', async () => {
    const result = await callHandler(configHandler, {
      env: { LANTERN_ANONYMOUS_WRITE_DATABASE: 'staging' },
    })
    expect(result.status).toBe(200)
    expect(result.json).toEqual({ defaultDatabase: 'staging' })
  })

  it('defaults to staging when public reads are pinned to staging', async () => {
    const result = await callHandler(configHandler, {
      env: { LANTERN_PUBLIC_READ_DATABASE: 'staging' },
    })
    expect(result.json).toEqual({ defaultDatabase: 'staging' })
  })

  it('keeps production as the safe default when no staging signal exists', async () => {
    const result = await callHandler(configHandler, { env: {} })
    expect(result.json).toEqual({ defaultDatabase: 'production' })
  })
})
