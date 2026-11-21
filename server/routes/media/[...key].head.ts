// HEAD parity with the original Flask Worker.
//
// The Flask /media/* branch (original-flask/src/worker.py:1054-1199) has no
// method check, so HEAD is served with the same status and headers as GET and
// the runtime strips the body. Nitro registers `[...key].get.ts` as
// `method:"get"` only, so HEAD previously fell through to the Nuxt 404 page.
//
// Re-exporting the GET handler guarantees one implementation for both methods:
// all media behavior, Range handling, error responses, the A1 Service Binding
// proxy, and the existing staging-preview logic are preserved unchanged. The
// incoming method is carried through by buildMediaOriginRequest (event.request
// is returned as-is when it is already a /media/* Request, otherwise the
// method is taken from getMethod(event)), so the Flask origin receives HEAD.
export { default } from './[...key].get'
