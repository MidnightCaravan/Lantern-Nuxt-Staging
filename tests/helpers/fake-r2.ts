import { vi } from 'vitest'

export type FakeR2Object = {
  bytes: Uint8Array
  httpMetadata?: Record<string, string>
}

export type FakeR2Upload = {
  key: string
  uploadId: string
  httpMetadata?: Record<string, string>
  parts: Map<number, Uint8Array>
}

export function createFakeR2() {
  const objects = new Map<string, FakeR2Object>()
  const uploads = new Map<string, FakeR2Upload>()
  const deleted: string[] = []
  const aborted: string[] = []
  let nextUploadId = 1

  const toBytes = (value: string | Uint8Array): Uint8Array =>
    typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value)

  const readBody = async (
    body: string | Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> => {
    if (!body || typeof (body as ReadableStream<Uint8Array>).getReader !== 'function') {
      return toBytes(body as string | Uint8Array)
    }
    const chunks: Uint8Array[] = []
    const reader = (body as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value instanceof Uint8Array ? value : new Uint8Array(value))
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }

  function objectResponse(record: FakeR2Object, range?: { offset: number; length: number }) {
    const bytes = range
      ? record.bytes.slice(range.offset, range.offset + range.length)
      : new Uint8Array(record.bytes)
    return {
      bytes,
      size: record.bytes.byteLength,
      httpMetadata: record.httpMetadata ?? {},
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(bytes))
          controller.close()
        },
      }),
      async arrayBuffer() {
        return new Uint8Array(bytes).buffer
      },
    }
  }

  const bucket = {
    objects,
    uploads,
    deleted,
    aborted,

    put: vi.fn(async (key: string, body: string | Uint8Array | ReadableStream<Uint8Array>, options?: { httpMetadata?: Record<string, string> }) => {
      objects.set(key, { bytes: await readBody(body), httpMetadata: options?.httpMetadata })
    }),

    get: vi.fn(async (key: string, options?: { range?: { offset: number; length: number } }) => {
      const record = objects.get(key)
      return record ? objectResponse(record, options?.range) : null
    }),

    head: vi.fn(async (key: string) => {
      const record = objects.get(key)
      return record ? { size: record.bytes.byteLength, httpMetadata: record.httpMetadata ?? {} } : null
    }),

    delete: vi.fn(async (key: string) => {
      deleted.push(key)
      objects.delete(key)
    }),

    createMultipartUpload: vi.fn(async (key: string, options?: { httpMetadata?: Record<string, string> }) => {
      const uploadId = `upload-${nextUploadId++}`
      uploads.set(uploadId, { key, uploadId, httpMetadata: options?.httpMetadata, parts: new Map() })
      return { key, uploadId }
    }),

    resumeMultipartUpload: vi.fn((key: string, uploadId: string) => {
      const upload = uploads.get(uploadId)
      if (!upload || upload.key !== key) {
        throw new Error(`Unknown multipart upload: ${key} ${uploadId}`)
      }
      return {
        async uploadPart(partNumber: number, body: string | Uint8Array | ReadableStream<Uint8Array>) {
          upload.parts.set(partNumber, await readBody(body))
          return { partNumber, etag: `etag-${partNumber}` }
        },
        async complete(parts: Array<{ partNumber: number; etag: string }>) {
          const bytes = new Uint8Array(parts.reduce((total, part) => total + (upload.parts.get(part.partNumber)?.byteLength ?? 0), 0))
          let offset = 0
          for (const part of parts) {
            const chunk = upload.parts.get(part.partNumber)
            if (!chunk) throw new Error(`Missing uploaded part ${part.partNumber}`)
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
          objects.set(key, { bytes, httpMetadata: upload.httpMetadata })
          uploads.delete(uploadId)
          return { key }
        },
        async abort() {
          aborted.push(uploadId)
          uploads.delete(uploadId)
        },
      }
    }),

    text(key: string) {
      return Buffer.from(objects.get(key)?.bytes ?? new Uint8Array()).toString()
    },
  }

  return bucket
}

export type FakeR2 = ReturnType<typeof createFakeR2>
