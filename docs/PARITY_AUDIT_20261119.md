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

### Page `<title>` values did not match Flask
- Flask has no global title suffix: each template fully controls `<title>` (`src/templates/base.html:11` and the 26 `{% block title %}` overrides). Some titles end in `— Lantern` (e.g. `dashboard.html:3-5`), others deliberately do not (e.g. `login.html:3` = `Log In`, `register.html:3` = `Join Lantern`, `forgot_password.html:3` = `Forgot Password`, `password_reset_sent.html:3` / `verification_sent.html:3` = `Check Your Email`, `chapter_editor.html:3-7`).
- Nuxt's layout applied `titleTemplate: (title) => \`${title} — Lantern\`` to every page, so suffix-less titles gained an incorrect suffix and titles that already contained `— Lantern` were doubled. Verified against the built Worker before the fix: `/forgot-password` rendered `Forgot Password — Lantern — Lantern`, `/register` rendered `Join Lantern — Lantern`, `/dashboard` rendered `Dashboard — Lantern` only because the page omitted its suffix.
- Fixed by making the layout's `titleTemplate` non-appending (`title || 'Lantern — Light Your Story'`) and setting each active page's exact Flask title, including reordering both comic-reader titles to Flask's `{work title} — {episode title} — Lantern` order (`comic_reader.html:3-7`) and adding the discover title (`discover.html:3-5`). Pure redirect pages were left unchanged.
- Verified against the rebuilt local Worker: `/` → `Lantern — Light Your Story`, `/login` → `Log In`, `/register` → `Join Lantern`, `/forgot-password` → `Forgot Password`, `/password-reset-sent` and `/verification-sent` → `Check Your Email`, `/resend-verification` → `Verify Your Email`, `/reset-password/:token` → `Reset Password`, `/dashboard` → `Dashboard — Lantern`, `/discover` → `Discover — Lantern`. All match the corresponding Flask templates exactly.

### Missing branded 404 page
- `templates/404.html:1-36` defines a branded Not Found page (title `Not Found — Lantern`, 🏮 icon, heading `Not Found`, subtitle `This Lantern doesn't exist.`, `Return Home` button) used both by the error handler and by many resource lookups (e.g. `lantern_public.py:123,181,223,239`, `lantern_publishing.py:48,187,268,363`).
- Nuxt had no `error.vue` or catch-all page. An unmatched URL returned a raw Nitro JSON 404 (`{"error":true,"statusCode":404,...}`), with no Lantern branding or HTML page.
- Added `app/pages/[...slug].vue` (sets HTTP 404 and renders the Flask markup within the default layout, so the header/footer are present) and `app/error.vue` (same branded card for 404s raised during page setup, with a generic variant for other errors).
- Verified against the rebuilt local Worker: `/definitely-not-a-route` now returns `404 text/html` with `<title>Not Found — Lantern</title>`, the `site-header`, `This Lantern doesn't exist.`, and `Return Home`; normal routes remain 200.

### User-facing copy and icons diverged from the Flask templates
A literal-string comparison of all 26 content templates against `app/pages/` found several user-visible differences that were aligned:
- **Homepage** (`templates/index.html`): `Explore Lantern` pointed at `/discover` instead of the in-page `#discover` anchor; the `AI Works` tab was absent; the no-works state showed one generic card instead of Flask's three (`Coming Soon`, `Your Story Could Be Here`, `Light Something New`); missing covers used a logo image instead of 🏮.
- **Discover** (`templates/discover.html:172-198`): the empty state omitted `Be one of the first creators to light it up.` and the `Create Your First Work` button.
- **Authentication pages**: aligned headings, subtitles, field labels/placeholders, button labels, footer links and auth icons with `login.html`, `register.html`, `forgot_password.html`, `resend_verification.html`, `reset_password.html`, `password_reset_sent.html` and `verification_sent.html`. Examples: `Forgot Password?` / `Back to Login`, `Create your free creator account.` / `Your email stays private.` / `Create Free Account`, `Need another verification link?` / `Send Verification Email`, `Choose a new password for your Lantern account.` / `Change Password` / `Enter it again`, and icons 🔑 / 📧 / 🔐 instead of 🏮 / ✉️.
- **Public work pages**: `work.html:25-35` uses `Created by @username` (`works/[id].vue` had `By @username`); `comic_public.html:45-65` shows `By {display name}` plus a `View Creator` button, which was missing from `comics/[id].vue`.
- Verified against the rebuilt local Worker: all aligned strings, tabs, and links render on `/`, `/discover`, `/forgot-password`, `/register`, `/resend-verification`, `/password-reset-sent`, and `/reset-password/:token` (the reset form is gated on a valid token, as in Flask).

### Remaining workspace, reader and editor copy aligned
A second literal-text pass covered text nodes and `placeholder`/`aria-label`/`alt`/`title`/`value` attributes across all 26 content templates (including Nuxt components):
- **Comic reader** (`comic_reader.html:64-96`): navigation now uses Flask's `← Episode {{ number }}` / `Episode {{ number }} →` instead of generic `Previous`/`Next` labels (`app/pages/comic/episode/[episodeId]/read.vue`).
- **Episode discussion** (`comic_reader.html:164-182`): the logged-out card now shows Flask's `Log in to leave a comment and talk with other Lantern readers.` (the work discussion keeps its own `Log in to comment, reply, and react to the community.` text) via a `kind`-conditional in `LanternDiscussionPanel.vue`.
- **Video uploader** (`edit_work.html:110`): helper text restored to `Large videos upload in chunks, and failed chunks can be retried.` (Nuxt had inserted `16 MiB`).
- **Edit work** (`edit_work.html:277-283`): footer link restored to `← Back to Dashboard`.
- **Placeholders** (`chapter_editor.html:72,90`, `create_work_form.html:89`, `edit_profile.html:444`): Flask uses three ASCII dots (`...`); Nuxt used the single `…` glyph. Aligned all four. Added the missing `Chapter title...` placeholder to the chapter editor title input.
- **Public work** (`work.html:38`): restored `aria-label="Video player"` on the video section.
- Dynamic counts (`0 pages`, `0 comments`) and `COMMUNITY` vs `Community` are not gaps: the counts are rendered from data and `.section-eyebrow` applies `text-transform: uppercase`.
- After these fixes, the literal text/attribute comparison reports zero missing strings. The check was promoted into `tests/flask-template-copy.test.ts` so future edits cannot silently reintroduce drift. `npm run verify` remains green (48 routes, gap=0, all tests passing, build OK); its current test count grows as the behavioral gaps below gain regression coverage.

### Comment creation status, ID and error wording did not match Flask
- `lantern_work_discussions.py:129-177` and `lantern_discussions.py:166-177` return **201** with `cursor.lastrowid`. The Nuxt handler returned 200 and found the new ID with `SELECT ... ORDER BY id DESC LIMIT 1`, which could return another user's concurrent comment on the same work.
- Fixed `server/api/discussions/[kind]/[targetId].post.ts` to take `meta.last_row_id` from the INSERT (the D1 equivalent of `cursor.lastrowid`), set HTTP 201, and use Flask's exact `Reply target was not found in this work's discussion.` wording.
- Added `tests/discussion-post.test.ts` (5 cases) covering creation, ID selection with pre-existing comments, empty/oversized validation, cross-discussion reply rejection and the production-write guard. Extended `tests/helpers/fake-d1.ts` to model comment inserts, the work/discussion lookups and the 201 projection.

### Episode creation used a race-prone ID lookup
- `lantern_comic_episodes.py:93-115` inserts an episode and takes `cursor.lastrowid`. Nuxt selected the new row by `(work_id, episode_number) ORDER BY id DESC`, which can return the wrong row when two episodes are created concurrently with the same computed number.
- Fixed `server/api/comic/works/[workId]/episodes.post.ts` to use `INSERT ... RETURNING id`, matching the chapter-creation handler. Added `tests/comic-episode-create.test.ts` (4 cases) for first-episode numbering, `MAX + 1` isolation across works, title validation and ownership, plus fake-D1 support for episode inserts and numbering queries.

### Discussion listing used a generic 404
- `lantern_work_discussions.py:49-51` returns `Published work not found.` and `lantern_discussions.py:64` returns `Episode not found.` for missing discussions. The Nuxt GET handler returned `Discussion not found.` for both.
- Fixed `server/api/discussions/[kind]/[targetId].get.ts` to use Flask's kind-specific wording. Added `tests/discussion-list.test.ts` (4 cases) for the comment projection/ordering/ownership and all three error paths, with fake-D1 support for the listing query.

### Jinja filters on dynamic values were not reproduced
- `templates/dashboard.html:81` renders `{{ work.status|capitalize }}`, so Flask shows `Draft` / `Published`; Nuxt rendered the raw `draft` / `published`. `templates/discover.html:143` renders `{{ work.description|truncate(150, True) }}`; Nuxt rendered the full description with no truncation.
- Added `app/utils/lantern-format.ts` with `jinjaCapitalize` and `jinjaTruncate150`. The truncate boundary was verified against the pinned Jinja runtime: ≤155 characters unchanged, otherwise 147 characters plus `...`. Applied in `app/pages/dashboard.vue:144` and `app/pages/discover.vue:65`.
- Added `tests/jinja-filter-parity.test.ts`: it enumerates every filtered output in the pinned Flask snapshot and asserts a documented Nuxt counterpart, so a newly introduced Flask filter fails the build until handled. It also tests both helpers at their boundaries.

## 2. Behavioral differences — recorded, not changed

### Media route response semantics
- Flask `/media/<path:key>` (`lantern_media.py:52-94`) returns **500** `"Media storage unavailable."` when `lantern_media` is unbound; Nuxt `server/routes/media/[...key].get.ts:41` returns **503**.
- Flask always reads the whole object and returns **200** with `Cache-Control: public, max-age=31536000`; it has no `Range` handling. Nuxt adds Range/206/416 handling for video (`:44-66`) and `private, no-store` for staging-owned objects (`:69`).
- Nuxt also adds staging ownership checks (`:27-40`) and path-traversal rejection (`:20`) that Flask does not have.
- Impact: low for cutover, because B5 keeps the legacy Worker as the production media origin. These Nuxt behaviors are deliberate staging protections. Not changed to avoid weakening those protections; reopen if the owner makes Nuxt the production media origin.

### Missing-resource public pages use an in-page card
- Flask renders the branded `404.html` for a missing published work (`lantern_public.py:123,181,223,239`), comic and creator (`lantern_profiles.py:179-183`).
- Nuxt catches the API error in the page and renders its own card instead: `app/pages/works/[id].vue:38` (`Work not found` / `Back to Discover` / `Retry`), `app/pages/comics/[id].vue:33` (`Comic not found` / `Back to Comics` / `Retry`) and `app/pages/@[username].vue:32` (`Creator not found` / `Discover Lantern`). These never reach `app/error.vue`, so the branded 404 restored for unmatched routes does not apply to them.
- Impact: both convey "not found" and return the correct HTTP status from the API, but the presentation differs from Flask. Recorded rather than changed — replacing three deliberate in-page states with a thrown 404 is a UI decision for the owner, and the extra `Retry` control would be removed.

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

### Flash and message wording
- Comparing all 54 distinct `flash()` strings in the Flask source against `app/` and `server/` found 13 without a verbatim match. Most are semantically equivalent rewordings, e.g. Flask's distinct `That username is already taken.` / `An account with that email already exists.` versus Nuxt's combined `That email address or username is already registered.`; `Comic storage is not available.` versus `Staging comic storage is not connected.`; `Unsupported thumbnail format.` versus the thumbnail handler's wording. Recorded, not changed.
- Two canonical success strings that Flask actually renders were aligned: verification → `Your email has been verified. You can now log in.` (`lantern_auth.py:323` → `server/api/auth/verify.post.ts`) and password reset → `Your password has been changed. You can now log in.` (`lantern_auth.py:742` → `server/api/auth/reset-password/[token].post.ts`).
- Unsupported comic pages: Flask flashes `Skipped unsupported image: {name}` and continues with the remaining files (`lantern_comic_editor.py:199-204`). Nuxt filters unsupported files client-side (`app/pages/comic/episode/[episodeId]/edit.vue:40,48,57`) and continues, but shows no per-file message. The skip-and-continue behavior is equivalent; only the flash text is absent.
- Logout: Flask flashes `You have been logged out.` and redirects to `/` (`lantern_auth.py:539-552`), but `templates/index.html` never calls `get_flashed_messages()`, so the message is not displayed on the homepage and can only surface on a later page that renders flashes. Nuxt clears the session and navigates to `/` with no message. Not changed, to avoid inventing a display Flask does not have.
- `Your password uses an older password format…` is the already-documented B4 difference.

### Global head and static assets
- `base.html:1-16` sets `<html lang="en">`, the description `Lantern — a free creative community for novels, comics, videos, and AI-powered stories.`, and both an icon and an apple-touch-icon. The Nuxt layout was missing `lang`, had a shortened description, and had no apple-touch-icon. All three were restored in `app/layouts/default.vue` and verified in the built Worker's rendered `/login` HTML.
- `public/css/lantern.css` is byte-identical to Flask's `static/css/lantern.css`; the 26 content templates' literal text nodes and `placeholder`/`aria-label`/`alt`/`title`/`value` attributes now all have Nuxt matches. Flask's `static/js/lantern.js` is an empty file, so there is no client-side behavior to port.

### Minor UI differences
- Flask uses `static/images/lantern-logo.png` as both its favicon and apple-touch-icon (`base.html:8-9`); Nuxt uses the smaller `lantern-favicon.png` for the browser icon and the byte-identical `lantern-logo.png` for apple-touch-icon. Recorded rather than changed — the legacy logo is ~2 MB and the migration-specific favicon is ~318 KB, with no visible difference at favicon size.
- Nuxt login uses `autocomplete="username"` for the email input (`app/pages/login.vue:97`) where Flask uses `autocomplete="email"` (`templates/login.html:44`).
- Nuxt adds an "Account environment" selector and staging notes (`app/pages/login.vue:117-123`, `:137`) for migration testing.
- Flask validates only that an episode title is non-empty server-side (`lantern_comic_episodes.py:59-70`); the 200-character limit exists in the HTML input (`comic_episode.html:119-125`). Nuxt also enforces the limit in `server/api/comic/works/[workId]/episodes.post.ts:18`. Recorded as a server-side difference; the rendered form applies the same limit in both.
- The disabled "Creators" nav/footer item is **verified parity**: Flask disables it in `templates/base.html:26` and `:59`, and Nuxt mirrors it in `app/layouts/default.vue:59` and `:106`. The earlier non-blocking product-confirmation follow-up is resolved.

## 3. Potential risks

- Four unused `legacyBase` constants remain in `app/pages/login.vue:2`, `app/pages/works/[id].vue:26`, `app/pages/dashboard.vue:2`, and `app/pages/comics/[id].vue:24`. They have no runtime effect but keep a textual dependency on the legacy Worker. Left untouched to avoid unrelated refactoring.

## 4. Verified parity (sampled)

Each item below was checked against both implementations:

| Area | Flask evidence | Nuxt evidence |
|---|---|---|
| Comment body limit (5000), report reason limit (1000), empty validation | `lantern_work_discussions.py:111-115`, `:220-224`, `:267-271` | `server/api/discussions/[kind]/[targetId].post.ts:16-18`; `[commentId]/[action].post.ts:32-34`, `:42-44` |
| Comment ownership 403, self-report 400, report dedupe 409, 201 on create/report | `lantern_work_discussions.py:146-177`, `:216-217`, `:244-245`, `:263-277`, `:286` | `[commentId]/[action].post.ts:31`, `:38`, `:41`, `:45-47`; `[targetId].post.ts:40-47`; `tests/discussion-post.test.ts` |
| Comment ordering and like/liked-by-me projection, kind-specific 404 | `lantern_work_discussions.py:49-51`, `:57-84`; `lantern_discussions.py:64` | `[targetId].get.ts:12-13`, `:23-24`; `tests/discussion-list.test.ts` |
| Chapter numbering via `MAX + 1`, draft status, work timestamp update | `lantern_chapters.py:134-196` | `server/api/studio/works/[workId]/chapters.post.ts:18-24` |
| Autosave title/content update and saved_at response | `lantern_chapters.py:462-499` | `server/api/studio/chapters/[chapterId]/autosave.post.ts:14-21` |
| Episode numbering via `MAX + 1`, draft status | `lantern_comic_episodes.py:72-141` | `server/api/comic/works/[workId]/episodes.post.ts:20-42`; `tests/comic-episode-create.test.ts` |
| Comic publishing gates (no episodes; empty episodes listed by number) | `lantern_publishing.py:73-107` | `server/api/comic/works/[workId]/publish.post.ts:25-32` |
| Work creation types, title ≤ 200, description ≤ 2000, draft status | `lantern_works.py:70-174` | `server/api/studio/works.post.ts:10-23` |
| Discovery filter values, published-only, `updated_at DESC`, home limit 6 | `lantern_public.py:18-93` | `server/api/public/works.get.ts:8-47` |
| Token SHA-256 hash, 24h verification / 1h reset, old-token invalidation, one-time use | `lantern_tokens.py:28-163`, `lantern_auth.py:590-625` | `server/utils/lantern-auth.ts`, `server/api/auth/verify.post.ts`, `forgot-password.post.ts`, `reset-password/[token].post.ts` |
| Password-reset email subject and body | `lantern_auth.py:604-625` | `server/api/auth/forgot-password.post.ts:45` |
| Five rate-limit policies, fixed windows, HMAC keys, durable counters | `app.py:329-419` | `server/utils/lantern-rate-limits.ts`, `tests/rate-limits.test.ts` |
| Signed-cookie sessions (no server-side session store) | `lantern_auth.py:512-514` | `server/utils/lantern-auth.ts` |
| Header/nav/footer structure including disabled Creators item | `templates/base.html:15-71` | `app/layouts/default.vue:47-121` |

## 5. Unable to verify here

- The exhaustive literal-string comparison is **now complete and enforced**: `tests/flask-template-copy.test.ts` checks every visible text node and form-attribute value in the pinned Flask snapshot against the Nuxt pages, components and layout. It passes with three justified source-only exemptions (data-driven `0 comments` / `0 pages`, and `COMMUNITY` rendered uppercase by CSS). `tests/jinja-filter-parity.test.ts` covers the other blind spot — filters applied to dynamic values — by enumerating every filtered output in the pinned snapshot. Data-binding and behavioral equivalence outside those two surfaces remains sampled rather than exhaustive; it is covered by the route-coverage map and the API test harness.
- Any behavior requiring a deployed Cloudflare Worker or production bindings (B1, B7 route rollback, G3 sign-off).
