import { createFakeR2, type FakeR2 } from './fake-r2'

// Test oracle for the independent Flask media origin. This is a TypeScript
// port of LANTERN_PARITY_SOURCE_BUNDLE_.../original-flask/src/worker.py:1054-1199
// used only to verify that the Nuxt proxy forwards requests and responses
// without altering Flask semantics. The Python Worker itself is checked
// verbatim against that source in tests/lantern-media-rehearsal.test.ts.

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

function text(body: string, status: number, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers })
}

export type MediaOrigin = {
  fetch: (request: Request) => Promise<Response>
  calls: Array<{ url: string; method: string; range: string | null }>
}

export function createFlaskMediaOrigin(bucket: FakeR2): MediaOrigin {
  const calls: MediaOrigin['calls'] = []

  const fetch = async (request: Request): Promise<Response> => {
    calls.push({ url: request.url, method: request.method, range: request.headers.get('range') })

    const url = new URL(request.url)
    // Scope boundary of the rehearsal media Worker: non-media paths return an
    // explicit 404. See lantern-media-rehearsal/README.md.
    if (!url.pathname.startsWith('/media/')) return text('Media origin only.', 404)

    const key = url.pathname.slice('/media/'.length)
    const rangeHeader = request.headers.get('Range')

    const extension = key.includes('.') ? key.split('.').pop()!.toLowerCase() : ''
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream'
    const isVideo = contentType.startsWith('video/')

    let totalSize: number | null = null
    let rangeStart: number | null = null
    let rangeEnd: number | null = null
    let object: any

    try {
      if (isVideo && rangeHeader) {
        const metadata = await bucket.head(key)
        if (!metadata) return text('Media not found.', 404)

        totalSize = metadata.size
        if (totalSize === null || totalSize === undefined) return text('Video size unavailable.', 502)

        // Python: re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
        if (!match || (!match[1] && !match[2])) {
          return text('Invalid byte range.', 416, { 'Content-Range': `bytes */${totalSize}` })
        }

        const first = match[1]!
        const last = match[2]!
        try {
          if (first) {
            rangeStart = Number(first)
            rangeEnd = last ? Math.min(Number(last), totalSize - 1) : totalSize - 1
          } else {
            const suffixLength = Number(last)
            if (suffixLength < 1) {
              return text('Invalid byte range.', 416, { 'Content-Range': `bytes */${totalSize}` })
            }
            rangeStart = Math.max(totalSize - suffixLength, 0)
            rangeEnd = totalSize - 1
          }
        } catch {
          return text('Invalid byte range.', 416, { 'Content-Range': `bytes */${totalSize}` })
        }

        if (totalSize === 0 || rangeStart >= totalSize || rangeEnd < rangeStart) {
          return text('Range not satisfiable.', 416, { 'Content-Range': `bytes */${totalSize}` })
        }

        object = await bucket.get(key, { range: { offset: rangeStart, length: rangeEnd - rangeStart + 1 } })
      } else {
        // Flask passes the raw Headers object to R2 for non-video Range
        // requests (`get(key, range=request.headers)`). R2 does not interpret
        // that as an explicit byte range, so the observable result is the full
        // object with status 200 and no Content-Range. Model that result here.
        // The proxy itself never rewrites this; the origin Worker owns it.
        object = await bucket.get(key)
      }
    } catch {
      return text('Media unavailable.', 502)
    }

    if (!object) return text('Media not found.', 404)

    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000',
    })
    let status = 200

    if (isVideo) {
      headers.set('Accept-Ranges', 'bytes')
      if (totalSize === null) totalSize = object.size ?? null
      if (totalSize !== null) headers.set('Content-Length', String(totalSize))
      if (rangeStart !== null && rangeEnd !== null) {
        const actualLength = rangeEnd - rangeStart + 1
        headers.set('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${totalSize}`)
        headers.set('Content-Length', String(actualLength))
        status = 206
      }
    }

    return new Response(object.body, { status, headers })
  }

  return { fetch, calls }
}
