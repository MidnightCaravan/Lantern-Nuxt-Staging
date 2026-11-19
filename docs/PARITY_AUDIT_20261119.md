# Targeted parity audit — 2026-11-19

**Method:** direct read-only inspection of the original Flask source at `/Users/christian/lantern/src` and the Nuxt implementation in this repository. Two attempted background audit agents failed before doing any work (`ENOTFOUND opencode.ai`), so this audit was performed manually. It is **targeted**, not exhaustive: it covers the areas listed below and must not be read as a whole-application proof.

**Classification:** CONFIRMED GAP / BEHAVIORAL DIFFERENCE / POTENTIAL RISK / VERIFIED PARITY / UNABLE TO VERIFY.

## 1. Confirmed gaps — fixed in this commit

### Verification email wording differed from Flask
- Flask registration: subject `Verify your Lantern account`, body at `lantern_auth.py:226-247`.
- Flask resend: subject `Your Lantern verification link`, body at `lantern_auth.py:385-402`.
- Nuxt previously used one generic message (`Verify your Lantern email address`) for both and added an `htmlContent` part Flask never sends.
- Fixed in `server/utils/lantern-auth.ts` (distinct `registration`/`resend` content, text-only payload) and `server/api/auth/resend-verification.post.ts` (passes the stored `display_name`).
- Link target remains `/verify-email?token=...`, the documented canonical alias of Flask's `/verify/<token>` (`docs/parity-route-map.json:38-44`).

### Empty comic page uploads were persisted
- Flask skips empty files entirely: `lantern_comic_editor.py:219-222` (`if not data: continue`) — no R2 object and no `comic_pages` row.
- Nuxt `server/api/comic/episodes/[episodeId]/pages.put.ts` previously uploaded a zero-byte object and inserted a page row.
- Fixed with an early return when the decoded body is empty; regression test added in `tests/comic-pages.test.ts`.

## 2. Behavioral differences — recorded, not changed

### Media route response semantics
- Flask `/media/<path:key>` (`lantern_media.py:52-94`) returns **500** `"Media storage unavailable."` when `lantern_media` is unbound; Nuxt `server/routes/media/[...key].get.ts:41` returns **503**.
- Flask always reads the whole object and returns **200** with `Cache-Control: public, max-age=31536000`; it has no `Range` handling. Nuxt adds Range/206/416 handling for video (`:44-66`) and `private, no-store` for staging-owned objects (`:69`).
- Nuxt also adds staging ownership checks (`:27-40`) and path-traversal rejection (`:20`) that Flask does not have.
- Impact: low for cutover, because B5 keeps the legacy Worker as the production media origin. These Nuxt behaviors are deliberate staging protections. Not changed to avoid weakening those protections; reopen if the owner makes Nuxt the production media origin.

### Staging-only write restrictions
- Nuxt discussion, comic, and studio write handlers reject production-target writes (e.g. `server/api/discussions/[kind]/[targetId].post.ts:12`, `[commentId]/[action].post.ts:7`) and require CSRF tokens. Flask has no equivalent because it has no staging database.
- Impact: intentional migration isolation, documented in `docs/PARITY_HARNESS.md`.

### Registration validation is stricter in Nuxt
- Flask checks only that username/password are non-empty with a minimum length (`lantern_auth.py:74-114`).
- Nuxt additionally caps username at 80, password at 1024, email at 320, rejects control characters in usernames, and uses a regex email check (`server/api/auth/register.post.ts:26-34`).
- Impact: stricter than Flask; no legitimate Flask registration is rejected by these bounds. Retained.

### Login recovery presentation
- Flask redirects to the recovery page for legacy `scrypt:` hashes (`lantern_auth.py:470-483`); Nuxt returns `409 PASSWORD_RESET_REQUIRED` and renders an inline link (`app/pages/login.vue:61-67`).
- Already documented as B4 in `docs/CUTOVER_READINESS.md`. Not changed.

### Minor UI differences
- Nuxt login uses `autocomplete="username"` for the email input (`app/pages/login.vue:97`) where Flask uses `autocomplete="email"` (`templates/login.html:44`).
- Nuxt adds an "Account environment" selector and staging notes (`app/pages/login.vue:117-123`, `:137`) for migration testing.
- The disabled "Creators" nav/footer item is **verified parity**: Flask disables it in `templates/base.html:26` and `:59`, and Nuxt mirrors it in `app/layouts/default.vue:59` and `:106`. The earlier non-blocking product-confirmation follow-up is resolved.

## 3. Potential risks

- `server/api/discussions/[kind]/[targetId].post.ts:41` finds the new comment by `SELECT ... ORDER BY id DESC LIMIT 1` rather than using `RETURNING id`. Flask uses `cursor.lastrowid` (`lantern_work_discussions.py:131-160`). Under concurrent writes to the same work these could return the wrong row. Low likelihood in the current single-tenant staging workload; not changed because D1 `RETURNING` support would need verification against the pinned runtime.
- Four unused `legacyBase` constants remain in `app/pages/login.vue:2`, `app/pages/works/[id].vue:26`, `app/pages/dashboard.vue:2`, and `app/pages/comics/[id].vue:24`. They have no runtime effect but keep a textual dependency on the legacy Worker. Left untouched to avoid unrelated refactoring.

## 4. Verified parity (sampled)

Each item below was checked against both implementations:

| Area | Flask evidence | Nuxt evidence |
|---|---|---|
| Comment body limit (5000), report reason limit (1000), empty validation | `lantern_work_discussions.py:111-115`, `:220-224`, `:267-271` | `server/api/discussions/[kind]/[targetId].post.ts:16-18`; `[commentId]/[action].post.ts:32-34`, `:42-44` |
| Comment ownership 403, self-report 400, report dedupe 409, 201 on create/report | `lantern_work_discussions.py:146-160`, `:216-217`, `:244-245`, `:263-277`, `:286` | `[commentId]/[action].post.ts:31`, `:38`, `:41`, `:45-47`; `[targetId].post.ts:44` |
| Comment ordering and like/liked-by-me projection | `lantern_work_discussions.py:57-84` | `[targetId].get.ts:23-24` |
| Chapter numbering via `MAX + 1`, draft status, work timestamp update | `lantern_chapters.py:134-196` | `server/api/studio/works/[workId]/chapters.post.ts:18-24` |
| Autosave title/content update and saved_at response | `lantern_chapters.py:462-499` | `server/api/studio/chapters/[chapterId]/autosave.post.ts:14-21` |
| Episode numbering via `MAX + 1`, draft status | `lantern_comic_episodes.py:72-141` | `server/api/comic/works/[workId]/episodes.post.ts:22-42` |
| Comic publishing gates (no episodes; empty episodes listed by number) | `lantern_publishing.py:73-107` | `server/api/comic/works/[workId]/publish.post.ts:25-32` |
| Work creation types, title ≤ 200, description ≤ 2000, draft status | `lantern_works.py:70-174` | `server/api/studio/works.post.ts:10-23` |
| Discovery filter values, published-only, `updated_at DESC`, home limit 6 | `lantern_public.py:18-93` | `server/api/public/works.get.ts:8-47` |
| Token SHA-256 hash, 24h verification / 1h reset, old-token invalidation, one-time use | `lantern_tokens.py:28-163`, `lantern_auth.py:590-625` | `server/utils/lantern-auth.ts`, `server/api/auth/verify.post.ts`, `forgot-password.post.ts`, `reset-password/[token].post.ts` |
| Password-reset email subject and body | `lantern_auth.py:604-625` | `server/api/auth/forgot-password.post.ts:45` |
| Five rate-limit policies, fixed windows, HMAC keys, durable counters | `app.py:329-419` | `server/utils/lantern-rate-limits.ts`, `tests/rate-limits.test.ts` |
| Signed-cookie sessions (no server-side session store) | `lantern_auth.py:512-514` | `server/utils/lantern-auth.ts` |
| Header/nav/footer structure including disabled Creators item | `templates/base.html:15-71` | `app/layouts/default.vue:47-121` |

## 5. Unable to verify here

- Exhaustive field-by-field comparison of all 27 Flask templates against all Nuxt pages. This audit sampled the authentication, layout, and form areas; the remainder is covered only by the route-coverage map and the 121-test harness.
- Any behavior requiring a deployed Cloudflare Worker or production bindings (B1, B7 route rollback, G3 sign-off).
