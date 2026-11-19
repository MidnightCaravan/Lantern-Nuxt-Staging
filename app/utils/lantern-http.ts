// Flask answers a missing public resource by rendering templates/404.html with
// HTTP 404 (`lantern_public.py:123,181,223,239`, `lantern_profiles.py:179-183`,
// `lantern_comic_views.py:38,94,108`). Nuxt public pages read the resource
// through a JSON API, so the page itself must turn a 404 API response back into
// a 404 page response. This helper keeps that decision pure and testable.

type LanternFetchError = {
  statusCode?: unknown
  status?: unknown
  response?: { status?: unknown }
  data?: { statusCode?: unknown; status?: unknown }
}

/** True when a caught fetch/API error represents a missing resource (HTTP 404). */
export function isLanternNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as LanternFetchError
  const status = Number(
    candidate.statusCode ??
      candidate.status ??
      candidate.response?.status ??
      candidate.data?.statusCode ??
      candidate.data?.status,
  )
  return status === 404
}
