import { describe, expect, it } from 'vitest'
import { isLanternNotFound } from '../app/utils/lantern-http'

// Public pages convert a 404 API response into Flask's branded 404 page
// (templates/404.html, HTTP 404). This gate pins the detection so a fetch error
// shape change cannot silently reintroduce the in-page card.
describe('isLanternNotFound', () => {
  it('recognises a 404 by statusCode, status, response.status or data.statusCode', () => {
    expect(isLanternNotFound({ statusCode: 404 })).toBe(true)
    expect(isLanternNotFound({ status: 404 })).toBe(true)
    expect(isLanternNotFound({ response: { status: 404 } })).toBe(true)
    expect(isLanternNotFound({ data: { statusCode: 404 } })).toBe(true)
    expect(isLanternNotFound({ data: { status: 404 } })).toBe(true)
  })

  it('does not treat other failures as not-found', () => {
    expect(isLanternNotFound({ statusCode: 500 })).toBe(false)
    expect(isLanternNotFound({ statusCode: 503 })).toBe(false)
    expect(isLanternNotFound({ status: 403 })).toBe(false)
    expect(isLanternNotFound({})).toBe(false)
  })

  it('handles missing or non-object errors', () => {
    expect(isLanternNotFound(null)).toBe(false)
    expect(isLanternNotFound(undefined)).toBe(false)
    expect(isLanternNotFound('404')).toBe(false)
    expect(isLanternNotFound(404)).toBe(false)
  })
})
