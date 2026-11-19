import { createApp, defineEventHandler, toWebHandler } from 'h3'

export type RequestOptions = {
  env: Record<string, any>
  method?: string
  path?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
  params?: Record<string, string>
  rawBody?: string | Uint8Array
}

export function cookieValue(setCookie: string | null, name: string): string | null {
  if (!setCookie) return null
  const match = setCookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]!) : null
}

export async function callHandler(handler: any, options: RequestOptions) {
  const app = createApp()
  app.use('/api/test', defineEventHandler(async (event) => {
    event.context.cloudflare = { env: options.env }
    event.context.params = options.params ?? {}
    return handler(event)
  }))
  const webHandler = toWebHandler(app)
  const method = options.method ?? 'GET'
  const hasRawBody = options.rawBody !== undefined
  const headers: Record<string, string> = {
    origin: 'http://localhost',
    ...(options.body && !hasRawBody ? { 'content-type': 'application/json' } : {}),
    ...(hasRawBody ? { 'content-type': 'application/octet-stream' } : {}),
    ...options.headers,
  }
  let body: BodyInit | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    if (hasRawBody) {
      body = typeof options.rawBody === 'string' ? options.rawBody : new Uint8Array(options.rawBody!)
    } else if (options.body) {
      body = JSON.stringify(options.body)
    }
  }
  const response = await webHandler(new Request(`http://localhost${options.path ?? '/api/test'}`, {
    method,
    headers,
    body,
  }))
  const text = await response.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { json = text }
  return { response, status: response.status, json, headers: response.headers }
}
