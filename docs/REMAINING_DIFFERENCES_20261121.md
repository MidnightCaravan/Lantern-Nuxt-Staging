# Remaining Differences and Evidence — 2026-11-21

This record covers the final implementation batch after the public UI, auth,
studio, and video/media audits. It is **not** a claim of exhaustive parity: it
reports the known differences from those completed audits and the evidence
gaps that remain. The original Flask application at `~/lantern` is the
behavioral source of truth and was not modified.

## Resolved in this batch

| Difference | Flask evidence | Nuxt evidence | Verification |
| --- | --- | --- | --- |
| Comic reader markup and stylesheet were simplified | `src/templates/comic_reader.html:8-62,208-687` (header, page figures, empty state, navigation, complete inline CSS) | `app/pages/comic/episode/[episodeId]/read.vue:27-62`; `public/css/lantern-nuxt-overrides.css:38-125` | `tests/comic-reader-navigation.test.ts`, live `/comic/episode/2/read?source=staging` |
| Episode discussion used work-discussion styling rather than the reader's canonical styling | `src/templates/comic_reader.html:297-687` | `app/components/LanternDiscussionPanel.vue:177+` (`.episode-discussion` rules) | `tests/comic-reader-navigation.test.ts` |
| Public work/comic headers did not match Flask markup | `src/templates/work.html:9-35`; `src/templates/comic_public.html:9-65` | `app/pages/works/[id].vue:42-48`; `app/pages/comics/[id].vue:38-51` | live `/works/3?source=staging`, `/comics/6?source=staging` |
| Chapter byline and disabled navigation markup differed | `src/templates/chapter_public.html:18-40` | `app/pages/works/[workId]/chapters/[chapterId].vue:40,47,51` | live `/works/3/chapters/2?source=staging` |
| Homepage category art used `<img>` overlays instead of Flask's background art | `src/templates/index.html:100-129`; `static/css/lantern.css:3193-3216` | `app/pages/index.vue:39-66`; `public/css/lantern-nuxt-overrides.css:1-2` | live `/` HTML |
| Forgot-password email input lacked Flask's placeholder | `src/templates/forgot_password.html` | `app/pages/forgot-password.vue:5` | live `/forgot-password` HTML |
| Dynamic profile links were not URL-encoded | `src/templates/work.html:25-35`, `chapter_public.html:19-21`, `comic_public.html:45-65` (`url_for` quotes usernames) | `app/pages/works/[id].vue:48`, `app/pages/comics/[id].vue:50`, `app/pages/works/[workId]/chapters/[chapterId].vue:40`, `app/components/LanternCommentNode.vue:16`, `app/pages/profile/edit.vue:5,47` | `tests/profile-link-parity.test.ts` |
| Multipart upload did not require `Content-Length` | `src/worker.py:571-582` (411 when absent) | `server/api/studio/works/[workId]/video-multipart/part.put.ts:22-31` | `tests/video-uploads.test.ts`, `tests/write-isolation.test.ts` |
| Direct and multipart uploads buffered the body instead of streaming it | `src/worker.py:586,823-829` (`request.body` passed to R2) | `server/api/studio/works/[workId]/video-direct.put.ts:17-24`; `server/api/studio/works/[workId]/video-multipart/part.put.ts:32-39` | `tests/video-uploads.test.ts` asserts a `ReadableStream` reaches R2 |
| Media responses used R2 metadata instead of the extension-derived type | `src/worker.py:1058-1071` | `server/routes/media/[...key].get.ts:119-122` | `tests/media-serving.test.ts`, `tests/media-head-parity.test.ts` |

## Follow-up batch — full-surface comparison (same day)

A fresh read-only comparison of the complete Flask application against Nuxt
resolved these additional concrete differences:

| Difference | Flask evidence | Nuxt evidence | Verification |
| --- | --- | --- | --- |
| Anonymous `/dashboard` and `/profile/edit` rendered in-page errors instead of Flask's login redirect | `src/app.py:186-203` (`login_required` flashes `Please log in to continue.` and redirects to `/login`); applied at `src/lantern_works.py:24-28` and `src/lantern_profiles.py:19-24` | `app/pages/dashboard.vue:2`, `app/pages/profile/edit.vue:2` now declare `middleware: ['auth']`; the guard and login page already produce the exact flash (`app/middleware/auth.ts:52-57`, `app/pages/login.vue:24-26`) | `tests/auth-middleware-session.test.ts` |
| Comic page upload skipped zero-byte files and used legacy POST-form wording | Canonical UI sends each file as a raw PUT (`src/templates/comic_episode.html:96-105,1149-1166`); that Worker branch stores `request.body` verbatim with no empty check and inserts a page row (`src/worker.py:241-278`); UI reports `All pages added to draft.` (`:1193-1197`). The old `if not data: continue` guard (`src/lantern_comic_editor.py:219-222`) is unreachable from the rendered form. | `server/api/comic/episodes/[episodeId]/pages.put.ts:34-42` now stores empty bodies and returns a page number; `app/pages/comic/episode/[episodeId]/edit.vue:149-152` reports Flask's canonical status | `tests/comic-pages.test.ts`, `tests/flask-flash-parity.test.ts` |
| Direct thumbnail upload left old non-cover-prefixed objects behind | `src/worker.py:1031-1042` deletes any changed old cover beginning `/media/` | `server/api/studio/works/[workId]/thumbnail-direct.put.ts:27-30` now uses the same `/media/` condition | `tests/thumbnail-direct-parity.test.ts` |
| Login email input used `autocomplete="username"` | `src/templates/login.html:38-45` | `app/pages/login.vue:125` now uses `autocomplete="email"` | `tests/flask-template-copy.test.ts` |

## Follow-up batch — discussions, comic access, video validation (same day)

A further read-only workflow comparison resolved these concrete differences:

| Difference | Flask evidence | Nuxt evidence | Verification |
| --- | --- | --- | --- |
| Failed edit/reply discarded the comment draft and left a permanent `Saving…` status | `src/templates/work_discussion.html`, `src/templates/comic_reader.html` (inline fetch handlers keep the form open and show the error on the comment) | `app/components/LanternCommentNode.vue` now awaits `:submit-handler`; `app/components/LanternDiscussionPanel.vue:nodeSubmit` rethrows so the node keeps its draft and shows `errText()` inline | `tests/discussion-ui.test.ts` |
| Report success message and `Reported` button state were discarded by an immediate reload | `src/lantern_discussions.py:301`, `src/lantern_work_discussions.py:286` return `Thank you. Your report was submitted.` | `app/components/LanternDiscussionPanel.vue:action` reads `result.message`, marks the real comment node `reported`, sets `reportMessage`, and skips `load()`; `LanternCommentNode.vue` shows `Reported` | `tests/discussion-ui.test.ts` |
| Root comment success/error feedback was missing; all action errors went to a reload-only panel banner | Canonical inline status handling in both discussion templates | `rootStatus` (`Comment posted.` / error) and `.success`/`.error` classes; action errors propagate to the originating node; load error uses `Retry loading discussion` | `tests/discussion-ui.test.ts` |
| Episode discussion presentation omitted the login icon/`h3`, `comment-form-user` block, `🏮` empty state, and the work `COMMUNITY` eyebrow | `src/templates/comic_reader.html:118-205` | `app/components/LanternDiscussionPanel.vue` template additions | `tests/discussion-ui.test.ts`, live SSR `/comic/episode/2/read?preview=1`, `/works/3` |
| A published comic episode returned 404 when a copied editor link still carried `?preview=1` | `src/lantern_comic_views.py:97-109` — ownership, not a query flag, gates draft access | `server/api/comic/episodes/[episodeId]/read.get.ts` now enters the preview branch only for an owned episode; public media URLs are preserved for logged-in non-owners | `tests/comic-read-access.test.ts`, live `/api/comic/episodes/2/read?preview=1` → 200 with `/media/...` URLs |
| Direct/multipart video size validation collapsed Flask's distinct statuses and messages | `src/worker.py:785-800` (411 missing, 400 invalid/empty, 413 too large) and `:555-565` (400 bad metadata, 400 empty, 413 too large) | `video-direct.put.ts` and `video-multipart/part.put.ts` now split those checks | `tests/video-uploads.test.ts` |
| Dashboard thumbnail upload showed an extra success banner Flask never renders | `src/templates/dashboard.html:553-575` only checks `response.ok` then reloads | `app/pages/dashboard.vue:uploadThumbnail` no longer displays the response body message | `tests/thumbnail-uploads.test.ts`, `tests/write-isolation.test.ts` |
| Comic editor rendered a legacy `Skipped unsupported image:` flash | Canonical editor's `isAllowed()` silently returns for disallowed MIME types (`src/templates/comic_episode.html:655-668,678-685`) | `app/pages/comic/episode/[episodeId]/edit.vue` now silently drops such files; flash moved to `DOCUMENTED_DIFFERENCE` | `tests/flask-flash-parity.test.ts`, `docs/PARITY_AUDIT_20261119.md` |
| Novel chapter editor lacked Flask's saved/unsaved/saving status, Ctrl/Cmd+S, and dirty-close warning | `src/templates/chapter_editor.html` | `app/pages/chapter/[chapterId]/edit.vue` adds `statusState`, keydown/beforeunload listeners, and matching classes | `tests/novel-chapters.test.ts` |

## Follow-up batch — dashboard/profile and public-presentation audits (same day)

Two read-only full-journey audits produced these outcomes:

| Item | Classification | Evidence | Disposition |
| --- | --- | --- | --- |
| Like/unlike button called the removed `emit` after the discussion handler refactor | **CONFIRMED REGRESSION — FIXED** | `src/templates/work_discussion.html:323-343`, `comic_reader.html:849-870`; `LanternCommentNode.vue` had no `defineEmits` but still called `emit('action',…,'like')` | `@click="doAction('like')"`; `tests/discussion-ui.test.ts` now guards against any `emit(` calls |
| Inline action status rendered twice while editing/replying | **CONFIRMED REGRESSION — FIXED** | Flask keeps the status inside the inline form (`work_discussion.html:257-259`); the old Nuxt guard `v-if="status && !mode"` was weakened to `v-if="status || comment.reportMessage"` | Restored `v-if="(!mode && status) || comment.reportMessage"`; test added |
| Failed profile edit showed an inline error and kept rejected values, with a broken profile link | **BEHAVIORAL DIFFERENCE — FIXED** | `src/lantern_profiles.py:64-74,104-114` re-renders the untouched DB row; `edit_profile.html` and `base.html` have no flash block, so the queued flash surfaces on the next flash-rendering page (e.g. `dashboard.html:373-385`) | `app/pages/profile/edit.vue` now restores all fields from `profile`, suppresses the inline error, and queues the message via `useLanternFlash()`; `app/pages/dashboard.vue` consumes queued flashes. `tests/dashboard-profile-ui.test.ts` |
| Thumbnail upload failure used an inline per-error banner and in-place refresh | **BEHAVIORAL DIFFERENCE — FIXED** | `src/templates/dashboard.html:569-586` always shows `alert("Thumbnail upload failed. Please try again.")` and uses `window.location.reload()` on success with no success flash | `app/pages/dashboard.vue` now uses that fixed alert, ignores the server body, and does a full reload on success; `tests/dashboard-profile-ui.test.ts` |
| Comment `@handle` was a profile link in Nuxt but inert text in Flask | **BEHAVIORAL DIFFERENCE — FIXED (owner-approved)** | `src/templates/work_discussion.html:306-309`, `comic_reader.html:830-833` use `handle.textContent` | `LanternCommentNode.vue` now renders a plain `<div class="comment-handle">`. Other approved profile-link encoding fixes are untouched. `tests/presentation-parity.test.ts` |
| Chapter body rendered in a bordered card with `line-height: 1.95` instead of Flask's inline `line-height: 1.8` | **BEHAVIORAL DIFFERENCE — FIXED (owner-approved)** | `src/templates/chapter_public.html:23` inline style; `public/css/lantern-nuxt-overrides.css:24` `.nuxt-chapter-content` | Removed the added padding/border/background and set `line-height: 1.8`, preserving Flask's `white-space`/`overflow-wrap`. `tests/presentation-parity.test.ts` |

All other journeys in both audits were at parity: dashboard listing/create/edit/delete/first-page/remove, anonymous redirects, video dashboard mapping, public profile view, homepage discovery, work/comic detail, chapter/comic readers, and the full discussion lifecycle except the Like regression above.

A final pass over the remaining canonical templates (`discover.html`,
`verification_sent.html`, `password_reset_sent.html`, `base.html`) found two
trivial markup differences, both fixed:

| Difference | Flask evidence | Nuxt evidence | Verification |
| --- | --- | --- | --- |
| Discover cover `alt` appended ` cover` | `src/templates/discover.html:110` uses `alt="{{ work.title }}"` (unlike `index.html`) | `app/pages/discover.vue:59` now uses `:alt="work.title"` | `tests/presentation-parity.test.ts` |
| Footer "Creators" lacked the disabled tooltip | `src/templates/base.html:59` sets `title="Creator directory coming soon"` | `app/layouts/default.vue` now sets the same title | `tests/presentation-parity.test.ts` |

The two "sent" pages and the rest of the base layout are at parity. Flask's
`base.html` active-nav class has no matching CSS rule, so its absence in Nuxt
has no visual effect.

## Follow-up batch — auth and Worker error contracts (2026-11-22)

A further read-only audit of account workflows, all Worker-mirrored branches,
and the complete video workflow found these additional concrete differences.
They were fixed in this batch:

| Difference | Flask evidence | Nuxt evidence | Verification |
| --- | --- | --- | --- |
| Rate-limit IP used a raw, unvalidated `CF-Connecting-IP` header | `src/app.py:312-326` validates and canonicalizes the header with `ipaddress.ip_address()`, then validates `request.remote_addr`, else `"unknown"` | `server/utils/lantern-rate-limits.ts` now exports `canonicalizeClientIp()` and applies it to both sources | `tests/auth-parity-batch-20261122.test.ts` |
| Session cookie had a hard 12-hour `Max-Age` and `exp` payload | `src/app.py:52-75`, `src/lantern_auth.py:512-514` set no permanent-session options, so Flask issues a browser-session cookie with no timestamp | `server/utils/lantern-auth.ts` no longer sets `maxAge`/`exp`; legacy cookies carrying `exp` are still honoured until their timestamp | `tests/auth-parity-batch-20261122.test.ts` |
| Login/forgot-password/resend invented server-side presence and format validation | `src/lantern_auth.py:343-348,434-466,565-570` only strip/lowercase the values and return the generic failure/privacy result | `login.post.ts`, `forgot-password.post.ts`, `resend-verification.post.ts` no longer return `INVALID_INPUT`/`INVALID_EMAIL` or a 400 | `tests/auth-parity-batch-20261122.test.ts`, `tests/rate-limits.test.ts` |
| Multipart `start` collapsed empty size into the parse error | `src/worker.py:525-532` → `400 "The video file is empty."` | `start.post.ts` now distinguishes the two branches | `tests/video-uploads.test.ts` |
| Multipart `complete` returned 413 for missing/zero size and reused one part-entry error | `src/worker.py:605-631` splits 400/400/413 and three distinct part-entry messages | `complete.post.ts` now matches each branch, including `int()`-style truncation of part numbers | `tests/video-uploads.test.ts` |
| Multipart `complete` re-read D1 on the success path and ignored `meta.changes` | `src/worker.py:665-737` checks exactly one changed row and re-reads only inside its error handler | `complete.post.ts` now checks `meta.changes === 1` and verifies only after a failed update | `tests/video-uploads.test.ts` |
| Multipart metadata responses lacked `Cache-Control: no-store` and included an extra field | `src/worker.py:543-547,590-594` | `start.post.ts` and `part.put.ts` now send `no-store`; `start` returns only `{key, uploadId, partSize}` | `tests/video-uploads.test.ts` |
| A negative declared part length produced 411 | `src/worker.py:571-582` parses it and fails the equality check with 400 | `part.put.ts` now returns 400 | `tests/video-uploads.test.ts` |
| Extension normalization removed only one leading dot and did not trim in two endpoints | `src/worker.py:519-522,773-776,954-959` uses `.strip().lower().lstrip(".")` | `video-direct.put.ts`, `thumbnail-direct.put.ts`, `start.post.ts` now trim and strip all leading dots | `tests/video-uploads.test.ts` |
| Video publication success was not queued as a flash | `src/lantern_publishing.py:377-378` flashes `Your video is now published on Lantern.` | `app/pages/work/[workId]/edit.vue` now calls `flash.set(result.message, 'success')` before navigating, matching the novel publish path | `tests/flask-flash-parity.test.ts`, build |
| Video uploader validation/progress copy and presentation differed | `src/templates/edit_work.html:164-189,197,247,255-268` | `app/components/LanternVideoUploader.vue` now uses Flask's exact status strings, marks the file input `required`, adds the "Assembling video in storage…" phase, and reports failures only in the status area with a preview reload | `tests/video-uploader-copy.test.ts` |

### Follow-up batch — comic and novel workflow audit (2026-11-22)

Read-only end-to-end audits of the complete comic and novel journeys produced
four more concrete, low-risk differences, all fixed in this batch:

| Difference | Flask evidence | Nuxt evidence | Verification |
| --- | --- | --- | --- |
| Comic publication success was never queued as a flash, so the publisher got no confirmation anywhere | `src/lantern_publishing.py:145-155` flashes `Your comic is now published on Lantern.` before redirecting to `public_comic`; `comic_public.html` has no flash block, so it surfaces on the next flash-rendering page | `app/pages/work/[workId]/comic/index.vue` now calls `flash.set(result.message, 'success')` before navigating, matching the novel/video publish flow | `tests/workflow-audit-batch-20261122.test.ts` |
| Comic-page deletion rendered a green `Comic page deleted.` banner that Flask never shows | `src/worker.py:449-452` returns 200 plain text; `src/templates/comic_episode.html:1300` discards the body and reloads with no banner | `app/pages/comic/episode/[episodeId]/edit.vue` now refreshes without a success message | `tests/workflow-audit-batch-20261122.test.ts` |
| Whitespace-only root comment silently did nothing | `src/templates/work_discussion.html:437` and `comic_reader.html:985` set `Write something before posting.`; the submit button is never disabled (`:165`) | `app/components/LanternDiscussionPanel.vue` now shows that inline error and keeps the button enabled | `tests/workflow-audit-batch-20261122.test.ts`, `tests/discussion-ui.test.ts` |
| Whitespace-only reply/edit silently did nothing | `src/templates/work_discussion.html:271` and `comic_reader.html:785` set `Write something before submitting.` | `app/components/LanternCommentNode.vue` now shows that inline error and keeps the button enabled | `tests/workflow-audit-batch-20261122.test.ts` |

Newly audited and confirmed at parity (no change needed): comic draft creation,
episode create/edit numbering and text, page ordering (both leave gaps on
delete; neither has a reorder UI), first-page thumbnail selection, episode and
comic publish gating, public comic page, reader navigation filtering, chapter
numbering/ordering and tiebreakers, autosave semantics, novel publish gating,
public chapter reader, and discussion lifecycle.

### Follow-up batch — discovery, global navigation and profiles (2026-11-22)

A read-only end-to-end audit of discovery, the shared header/footer, and public
and editable profiles found five confirmed differences, all fixed here:

| Difference | Flask evidence | Nuxt change | Verification |
| --- | --- | --- | --- |
| `View Public Profile` and the public-address hint used the unsaved form username, so editing then previewing opened a 404 or another user's profile | `edit_profile.html:399-401,510-518` renders `user['username']`, re-read from the DB (`lantern_profiles.py:29-38`) | `app/pages/profile/edit.vue` now derives both from `savedUsername` (the loaded DB row) | `tests/discovery-nav-profile-batch-20261122.test.ts` |
| Successful profile update gave no confirmation anywhere — the local `notice` was lost when navigation unmounted the page | `lantern_profiles.py:140-151` flashes `Your profile has been updated.`; `profile.html` has no flash block, so it surfaces on the next dashboard visit (`dashboard.html:373-387`) | `flash.set(r.message,'success')` before navigate; the in-component notice was removed | `tests/discovery-nav-profile-batch-20261122.test.ts` |
| `/@%20warden%20` resolved in Nuxt but 404 in Flask; overlong names returned an in-page 200 card | `lantern_profiles.py:159-183` queries the raw `@<username>` segment and renders `404.html` on a miss | `server/api/public/profiles/[username].get.ts` no longer trims or caps length; `app/pages/@[username].vue` now throws the real error status instead of mislabeling it `Creator not found` | `tests/discovery-nav-profile-batch-20261122.test.ts`; live probes |
| Header/footer Discover links dropped `source`, so a staging preview silently switched database while the in-page filter bar preserved it | `base.html:22-25,56-65` uses canonical links; the source concept is Nuxt-only | `app/layouts/default.vue` now builds Discover links with `discoverHref()` from the current route's `source`, matching `discover.vue:43-47` | `tests/discovery-nav-profile-batch-20261122.test.ts`; live SSR probe |
| Header auth links were absent from SSR HTML until hydration | `base.html:29-38` renders Dashboard/Log Out or Log In/Join Free from `current_user` on every request | `useLanternAuth().refresh()` now resolves identity from the request event on the server (same helpers as `middleware/auth.ts`); the layout awaits it in setup instead of `onMounted` | `tests/discovery-nav-profile-batch-20261122.test.ts`; live SSR probe |

Confirmed at parity with no change: no search or pagination in either app,
`updated_at DESC` ordering, `novel|comic|video` type filtering fallback, the
unselected `All` filter, discover card alt text and empty state, creator-directory
disabled tooltip, and the branded 404.

Low-impact differences recorded, not changed: invalid `source` fails closed with
an error card (deliberate), logout label/failure note and Discover loading/error
cards (accepted SPA presentation), cross-source `Edit Profile` visibility
(intentional source isolation), profile-username `autocomplete`, discover cover
`loading="lazy"`, and the smaller migration favicon (explicitly accepted at
`docs/PARITY_AUDIT_20261119.md:137`).

### Follow-up batch — account form markup (2026-11-22)

A read-only audit of the account-lifecycle forms found two markup gaps, both
fixed:

| Difference | Flask evidence | Nuxt change | Verification |
| --- | --- | --- | --- |
| Register/login/resend inputs imposed client-only `maxlength` caps (80/320/1024) that Flask has and neither the server nor the schema enforces, so a Flask-valid long username could not be entered | `register.html:35-90`, `login.html:38-62`, `resend_verification.html:28-35` have no `maxlength`; `lantern_auth.py:90-123` is min-only | Removed `maxlength` from all seven inputs; kept `minlength`, `required`, `autocomplete`, placeholders | `tests/account-lifecycle-batch-20261122.test.ts` |
| Forgot/reset password inputs lacked the Flask `name` attributes | `forgot_password.html:28-35`, `reset_password.html:38-64` | Added `name="email"`, `name="password"`, `name="confirm_password"` | `tests/account-lifecycle-batch-20261122.test.ts` |

Verified at parity with no change: all labels, placeholders, remaining
attributes and validation messages, registration redirect to `/verification-sent`,
login redirect to `/dashboard`, verification token copy, generic
forgot/resend responses, reset-password validation order, and the legacy
`/verify-email?token=` alias. The owner-accepted B4 recovery presentation is
unchanged.

### Follow-up batch — edge-path parity for account and upload handlers (2026-11-22)

The previously recorded low-impact potential risks were reviewed against the
Flask source and are now fixed where a narrow, per-endpoint change preserves
behavior. The canonical clients were already internally consistent; these
changes cover stale/crafted requests and validation-message precedence only.

| Difference | Flask evidence | Nuxt change | Verification |
| --- | --- | --- | --- |
| A signed-in visitor to `/login` was auto-redirected to the dashboard instead of seeing the form | `lantern_auth.py:430,521-523` unconditionally renders `login.html` | Removed the `auth.refresh(true)` session branch from the login page's `onMounted`; the redirect after a successful submission is unchanged | `tests/account-lifecycle-batch-20261122.test.ts` |
| A short, mismatched registration password reported the mismatch first | `lantern_auth.py:90-123` checks username, then password length, then confirmation | Removed the client-side mismatch check so the API returns Flask's first error (`register.post.ts:35-46`); native `minlength` still blocks ordinary short input | `tests/account-lifecycle-batch-20261122.test.ts` |
| Direct video upload checked ownership before format/size, returning 404/409 where Flask returned 400/411 | `worker.py:773-817` validates extension and size before its ownership query | `video-direct.put.ts` now runs `ownedStudioWork()` after validation | `tests/upload-edge-parity-20261122.test.ts` |
| Multipart `complete` collapsed a missing parts list and a wrong-length list into one message | `worker.py:606-618` returns `Missing or invalid uploaded-parts list.` for a parse failure and `The video upload is incomplete. Please retry.` for a wrong-length list | `complete.post.ts` now splits the two checks | `tests/upload-edge-parity-20261122.test.ts` |
| `Number()` accepted exponent/hex declarations that Python `int()` rejects, and mapped arbitrary-precision sizes to 400 rather than 413 | `worker.py:525-532,555-575,606-611,785-800` | New `server/utils/lantern-flask-integers.ts` reproduces Python integer parsing (whitespace, sign, separators, arbitrary precision); all four upload handlers use it, and float JSON part numbers still truncate like `int()` | `tests/upload-edge-parity-20261122.test.ts` |
| Multipart reference values were not trimmed before validation | `worker.py:549-553` | `part.put.ts`, `complete.post.ts` and `abort.post.ts` trim `key`/`uploadId` before their regex checks | `tests/upload-edge-parity-20261122.test.ts` |

During connected-journey verification, an HTTP probe appeared to show anonymous
protected pages rendering the login view with status 200. That probe used the
Code Mode `fetch`, which follows redirects even when `redirect: 'manual'` is
set. A `curl` probe without redirect following confirmed that the existing
`navigateTo({ path: '/login', query: { reason: 'login-required' } })` in
`app/middleware/auth.ts` already returns a real 302 to
`/login?reason=login-required` for `/dashboard`, `/profile/edit`,
`/work/3/edit`, `/work/3/novel` and `/comic/episode/2/edit`. No middleware
change was needed; a temporary `external: true` variant was reverted because
it would have forced full page reloads on client-side navigation.

The video audit confirmed the rest of the complete journey at parity: work
creation/editing, extension/size validation core, multipart completion
semantics, publication, playback/delivery, and the absence of video thumbnails
in both apps.

### Flash display location — closed (2026-11-22 follow-up)

The one-time flash display location difference identified in the comic/novel
audit was subsequently implemented (the owner directed that confirmed gaps be
implemented rather than only documented):

| Difference | Flask evidence | Nuxt change | Verification |
| --- | --- | --- | --- |
| Publication/save flashes were consumed and rendered on their destination pages, but Flask's destination templates have no flash block | `chapter_editor.html`, `work.html` and `comic_public.html` contain no `get_flashed_messages`; neither does `base.html`. `lantern_publishing.py:343-347,377-378,145-150` flash then redirect to `view_work`/`public_comic`; `lantern_chapters.py:329-340` flashes then redirects to the editor | `app/pages/works/[id].vue` no longer consumes/renders the flash; `app/pages/chapter/[chapterId]/edit.vue` no longer consumes it or renders the extra `Chapter saved.` banner (the status bar still reports `Saved`). Flash producers still queue the message, and consumers remain on every page whose Flask template renders flashes (workspace, dashboard, login, edit-work, comic episode editor) | `tests/flash-location-parity.test.ts` |

The flash now survives client-side navigation until the next flash-rendering
page, matching Flask's session-flash lifetime. The remaining difference — that
Nuxt's `useState` flash is lost on a full browser reload while Flask's
session-cookie flash is not — is an accepted architecture difference recorded
in `docs/CUTOVER_READINESS.md`.

### Findings deliberately not changed (2026-11-22 audits)

- **Partial comic-page upload failure and retry.** When one file in a batch is
  rejected, Flask's editor leaves all files in `selected`, so clicking *Add to
  Draft* again re-uploads already-stored files and creates duplicate pages
  (`comic_episode.html:1149-1222`). Nuxt removes successfully-stored files from
  the selection, so a retry sends only the missing pages
  (`comic/episode/[episodeId]/edit.vue:151-165`). Nuxt is more forgiving, but it
  is not a one-to-one match. Deliberately reintroducing duplicate-page creation
  would be a regression in data integrity, so this is recorded as a
  **BEHAVIORAL DIFFERENCE** rather than changed.

### Intentionally not changed in this batch

These were found and recorded rather than silently altered:

- **Unverified-email login presentation (B4 pattern).** Flask redirects to
  `/resend-verification`; Nuxt keeps the user on `/login` with an inline
  recovery link. This is the owner-accepted presentation difference documented
  in `docs/CUTOVER_READINESS.md:54` and `docs/PARITY_AUDIT_20261119.md:114-116`.
  The API still returns Flask's exact base message.
- **Comic page upload endpoint contract.** The Worker branch returns `201` with
  plain text (`worker.py:299-302`); the Nuxt endpoint returns `200` JSON because
  the canonical editor consumes `pageNumber`. The editor flash text is already
  aligned; changing the API shape would break the working UI.
- **Shared Worker helper error wording and precedence.** `requireStudioIdentity`,
  `requireComicIdentity`, `ownedStudioWork`, and `ownedComicEpisode` are also used
  by non-Worker Flask-equivalent endpoints with different wording. Narrowing
  their messages/order to the Worker branches would require a wider refactor;
  recorded as a potential risk, not silently changed.
- **CSRF token source and Origin requirement.** Flask reads only `X-CSRF-Token`
  and has no Origin check. Nuxt's body-token support and same-origin enforcement
  are deliberate migration protections already documented in
  `docs/PARITY_AUDIT_20261119.md:105-107` and `docs/PRODUCTION_WRITE_SELECTION_20261121.md`.
- **Thumbnail-direct R2 failure status.** Flask propagates a generic 500;
  Nuxt returns a deliberate 502 with an actionable message.
- **Failed video-publication gating.** Flask flashes `Upload a video before
  publishing.` and redirects to `edit_work`; Nuxt returns 400 JSON and renders
  an inline error. The publish button is hidden without a video, so this is a
  direct/stale-request path. It follows the same API/SPA architecture difference
  already accepted for B4 and unverified-email login.

## Disposition register (2026-11-22)

Every difference still recorded in this document has now been assigned one of
the four requested dispositions.

| Disposition | Items | Decision |
| --- | --- | --- |
| **Genuine functional defect — fixed** | Comic/novel/video publication flashes, flash display location, comic page upload and access, discussion lifecycle, discovery navigation source, SSR auth links, profile editor URL/confirmation, account form attributes, registration/login edge behavior, upload validation and Worker error contracts, account/upload edge-path parity | Implemented in the batches above and gated by focused tests; no further work pending. |
| **Intentional safety improvement — keep** | CSRF Origin check and body/header token support; `source=production` write gates and fail-closed staging selectors; production write isolation; thumbnail-direct R2 failure as 502 with an actionable message; invalid `source` fails closed; no duplicate comic pages on upload retry | These protect staging data or prevent data loss. Reproducing the legacy behavior would weaken write isolation or create duplicate content, which is explicitly out of scope. |
| **Accepted architectural difference — keep** | B4 unverified-email recovery presentation; SPA logout label and loading/error cards; failed video-publication gating; Worker page-upload `200` JSON vs `201` text; shared Worker helper error wording; flash state lost on full reload; smaller migration favicon; discover cover `loading="lazy"`; profile `autocomplete`; cross-source `Edit Profile` visibility; legacy Worker URL coverage gap in the parity harness | User-visible API/SPA patterns or harness limitations already accepted; no functional loss in the canonical workflows. The harness `gap=0` result is explicitly limited to inventoried Flask routes. |
| **External dependency — cannot close here** | Real outbound verification/reset email; content created after the September Flask export; interactive browser/visual verification; production cutover blockers B1/B5 and release signoff | Requires mail credentials, a newer genuine export, browser tooling, or owner authorization for production. None were fabricated, inspected, or accessed. |

## Remaining differences and evidence gaps

| Item | Classification | Evidence | Impact / disposition |
| --- | --- | --- | --- |
| Real outbound verification/reset email delivery | **UNABLE TO VERIFY** | Rehearsal bindings in `wrangler.rehearsal.jsonc` expose only staging D1/R2, the media origin, and the staging read/write selectors; `server/utils/lantern-auth.ts:213-214` needs `LANTERN_BREVO_API_KEY` and `LANTERN_MAIL_FROM`/`MAIL_FROM`. | Credentials were not inspected or stored. Existing Flask behavior of issuing tokens without a configured mailer is preserved (`emailSent:false` / generic flash). Staging verification can be completed through the internal link. |
| Content created after the genuine September Flask export | **UNABLE TO VERIFY — source data unavailable** | Exhaustive local search found exactly one genuine Lantern data source: `~/lantern/lantern.db` (mtime 2026-09-28) and its SQL dump `~/lantern/lantern-d1.sql`. Counts: 1 user, 6 works, 1 chapter, 1 comic episode, 9 comic pages. This is precisely the September export already migrated to staging; no later export, dump, or dataset exists anywhere in the workspace or the original Flask repository. Production D1/R2 are read-only under `docs/PRODUCTION_WRITE_SELECTION_20261121.md`. | Any content beyond these records exists only in production D1/R2 (forbidden to read for migration purposes here) or requires a new genuine export from the owner. Nothing can be faithfully migrated without that source; no records are fabricated. Staging public catalog therefore contains only the migrated genuine works (WARDEN id `3`, The Lovers id `6`), alongside clearly named test fixtures that must not be treated as public content. |
| Interactive browser/visual verification | **UNABLE TO VERIFY** | Re-investigated on 2026-11-22: no Playwright/Puppeteer/jsdom/Selenium/Cypress dependency, browser binary cache, browser MCP tool, or browser-mode test provider exists. Safari 26.5 and raw `/usr/bin/safaridriver` are present, but session creation refuses until `Allow remote automation` is enabled; `safaridriver --enable` prompts for an administrator password and was not run to completion. A plain `open` + `screencapture` attempt failed with `could not create image from display`, so this harness has no accessible GUI display. | Verified through `npm run verify`, Node `fetch`, live SSR HTML, status/header checks, and the rehearsal smoke script. This does not replace a human browser pass. No application settings were changed. |
| ~~Authenticated missing/unowned workspace 404 path~~ | **VERIFIED PARITY** (2026-11-21) | Resolved by exercising a signed-in staging session against a remote-dev Worker using only staging bindings. `/work/5/novel`, `/work/5/comic`, `/work/5/edit` (work 5 is owned by another user) and `/work/99999/novel` all returned HTTP 404 with the branded `app/error.vue` page (title `Not Found — Lantern`, `This Lantern doesn't exist.`, `Return Home`) for a browser `Accept` header; `/work/3/novel` (owned) returned 200. The deployed Worker also renders the branded 404 for unmatched and missing public-resource URLs. The `application/json` body seen with `Accept: */*` is standard Nitro content negotiation, not a defect. Source: `app/error.vue:1-24`, `app/pages/work/[workId]/novel/index.vue:8-12`. | No code change required; the earlier 200 in-page-card behavior is already corrected by the `throw createError({ statusCode: 404 })` pattern. |
| Non-video `Range` requests through R2 | **CONFIRMED BEHAVIORAL DIFFERENCE — FIXED** (2026-11-21) | Genuine staging URLs were derived from `/api/public/works?source=staging` (`/media/uploads/covers/3/cover.png`) and `/api/comic/episodes/2/read?preview=1` (`/media/uploads/comics/6/1/page-*.png`). The private Flask media-origin Worker (`lantern-media-rehearsal`, a verbatim copy of `src/worker.py:1054-1199`, bound to the same staging bucket) was reached through a temporary local-only Service Binding relay — no production access. Live result: for **any** non-video `Range` value (valid, invalid, suffix, unsatisfiable), Flask returns status 200, `Content-Length` equal to the **number of request headers**, a body containing exactly that many leading bytes, and no `Content-Range`/`Accept-Ranges`. Adding five request headers increased the body from 13 to 18 bytes; adding twelve increased it to 25. This is R2 reading the `Headers` object's `length` as the range length from `src/worker.py:1154-1157`. The Nuxt staging path returned the full object (2,653,781 / 2,798,651 bytes). | `server/routes/media/[...key].get.ts` now reproduces the Flask branch locally for staging media: `bucket.get(key,{range:{offset:0,length:<header count>}})`, status 200, explicit `Content-Length`, no `Content-Range`. `tests/helpers/flask-media-origin.ts` was corrected from the old full-body model; `tests/media-range-parity.test.ts`, `tests/media-serving.test.ts`, `tests/media-origin-proxy.test.ts` cover header counts, all Range values, object-size capping, and forwarded-path parity. Video ranges were already at parity and are unchanged. |
| Legacy Worker URL coverage in the parity harness | **POTENTIAL RISK — harness inventory limitation** | `LANTERN_MIGRATION_AUDIT_20261118-002806/01_FLASK_ROUTES.csv` contains only Flask routes, not the Worker branches for page upload/delete, multipart/direct video, direct thumbnail, and media (`src/worker.py:82-90,309-317,460-483,756-760,875-883,1054-1055`). `scripts/parity-coverage.mjs:88-90` rejects map entries with no matching CSV route, so those branches cannot be added to `docs/parity-route-map.json` without editing the source inventory. Nuxt implements them semantically as `/api` endpoints, not at the legacy Worker URLs. | The `gap=0` result must be read as "all inventoried Flask routes reviewed", not as exhaustive Worker-route coverage. Do not modify the Nov 18 inventory artifact; keep this as an explicit limitation. |
| Production cutover blockers B1/B5 and the paused gateway decision | **PRESERVED DECISION** | `docs/CUTOVER_READINESS.md:67`; `docs/release-gates.json`; no `docs/release-signoff.json` exists. | Not code differences and not authorized work. Production D1/R2/Worker/DNS remain read-only; production release gate remains NOT READY. |

## Verification of this record

- Focused checks: public UI, profile links, auth, auth guard, comic pages and
  access, discussion UI, flash parity, thumbnails, media, video, novel chapters,
  and write-isolation suites passed.
- Full gate: `npm run verify` passed after the final edits — 48 routes reviewed
  (`vendor=2, api=29, covered=11, alias=4, embedded=2`, gap=0), 46 test files /
  510 tests passing, Nuxt build complete. `git diff --check` is clean.
- Deployment: only `npx wrangler deploy --config wrangler.rehearsal.jsonc` was
  used. Current rehearsal Version ID: `b6b99a45-6458-48af-97cb-218c0195bf44`.
- Live staging: rehearsal smoke 9/9; targeted checks confirmed `/api/public/config`
  → `{defaultDatabase:"staging"}`, `/api/comic/episodes/2/read` returning 200 with
  public `/media/...` URLs both with and without `?preview=1` (`isPreview:false`),
  the staging episode discussion list, a page object resolving 200 `image/png`,
  the new discussion presentation markers in SSR, and the anonymous `/dashboard`
  → `/login?reason=login-required` redirect. Earlier focused checks confirmed the
  login `autocomplete` fix, anonymous login redirects, public pages, and the
  branded 404.
- Non-video Range live check after this deployment: the WARDEN cover and
  The Lovers page-1 both return the full PNG without a Range header; with any
  Range header they return status 200, no `Content-Range`/`Accept-Ranges`, and
  exactly N leading bytes with `Content-Length: N` (N = the deployed Worker's
  request-header count, 12 for the baseline request and 17 with five extra
  headers). HEAD with a Range is a bodyless 200 with the same header set. This
  matches the genuine Flask origin observation; the earlier relay's count of
  13 included Miniflare's dev-only `mf-original-url` header.
- Auth parity live check after this deployment: blank `/api/auth/forgot-password`
  and `/api/auth/resend-verification` both return 200 with Flask's privacy-
  preserving messages instead of an invented 400, blank `/api/auth/login`
  returns 401 `"Invalid email or password."`, and the WARDEN cover Range check
  still returns 12 leading bytes with `Content-Length: 12` and no
  `Content-Range`, confirming no media regression. Rehearsal smoke: 9/9.
- Post-deployment regression probe after the comic/novel batch: `/`, `/login`,
  `/forgot-password`, `/works/3`, `/comics/6?source=staging`,
  `/comic/episode/2/read?preview=1` all returned 200, `/api/public/config`
  returned `{defaultDatabase:"staging"}`, and the WARDEN cover Range check still
  returned 12 leading bytes with `Content-Length: 12` and no `Content-Range`.
  Rehearsal smoke: 9/9.
- Post-deployment probe after the flash-location fix: `/`, `/login`,
  `/forgot-password`, `/works/3`, `/comics/6?source=staging`,
  `/comic/episode/2/read?preview=1` all returned 200, `/api/public/config`
  returned `{defaultDatabase:"staging"}`, and the WARDEN cover Range check still
  returned 12 leading bytes with `Content-Length: 12` and no `Content-Range`.
  Rehearsal smoke: 9/9. The flash change is client-side only, so the SSR HTML of
  `/works/3` no longer contains the publication flash banner (verified by the
  new `tests/flash-location-parity.test.ts` source gate).
- Post-deployment probe after the discovery/navigation/profile batch: SSR HTML
  for `/`, `/discover?source=staging`, `/works/3` and `/login` now contains
  `Log In` / `Join Free` with a non-empty `.header-actions` div; Discover links
  carry `type=novel&source=staging` and no bare `/discover?type=novel`;
  `/@%20warden%20` and an 90-character username both return branded HTTP 404
  while the genuine `Midnight Caravan` profile returns 200 and renders
  `Published Works`; the WARDEN cover Range check still returns 12 bytes with
  `Content-Length: 12` and no `Content-Range`. Rehearsal smoke: 9/9.
- Post-deployment probe after the account-form batch: `/register`, `/login`,
  `/resend-verification` and `/forgot-password` all returned 200 with no
  `maxlength` attribute in the SSR HTML, `name="email"` present, and SSR auth
  links present; the WARDEN cover Range check still returned 12 bytes with
  `Content-Length: 12` and no `Content-Range`. Rehearsal smoke: 9/9.
- Post-deployment probe after the edge-parity batch: `/dashboard`,
  `/profile/edit`, `/work/3/edit`, `/work/3/novel` and `/comic/episode/2/edit`
  each returned a real HTTP 302 to `/login?reason=login-required`, and the
  followed login page rendered `Please log in to continue.`; the connected
  public chain `/discover?source=staging` → `/comics/6?source=staging` →
  `/comic/episode/2/read?source=staging` → genuine
  `/media/uploads/comics/6/1/page-1-a8ea9b09d4ffd553.png` all returned 200, with
  the Range request returning 12 bytes, `Content-Length: 12`, no
  `Content-Range`. Account entry pages `/login`, `/register`,
  `/forgot-password`, `/resend-verification` and `/works/3` all returned 200.
  Rehearsal smoke: 9/9. Redirect status was checked with `curl` because the
  Code Mode `fetch` follows redirects even with `redirect: 'manual'`.
- Live form-submission probes with a fresh `/api/auth/csrf` cookie: a blank
  registration returned `MISSING_FIELDS`; a short **and** mismatched password
  returned `INVALID_PASSWORD` (Flask's length-before-confirmation order); a
  long but mismatched password returned `PASSWORD_MISMATCH`. Anonymous
  discussion reads for `/api/discussions/work/3?source=staging` and
  `/api/discussions/episode/2?source=staging` returned 200, while an anonymous
  comment POST returned 401 `Please log in to continue.` No test account or
  content was created. Rehearsal smoke: 9/9.

## Authenticated user-journey pass (2026-11-22)

This pass closed the remaining source/handler-only gap for signed-in
navigation without creating accounts or content.

- **Session method:** a staging-only `wrangler dev --config
  wrangler.rehearsal.jsonc` process was started on `127.0.0.1:8801` with a
  one-shot, locally injected non-production `LANTERN_NUXT_SESSION_SECRET`.
  A signed stateless `lantern_nuxt_session` cookie was minted in memory for the
  existing staging user id `4` (`Midnight Caravan`, `db=staging`, `uid=4`).
  No remote secret was read, no `.dev.vars` or credential file was opened, no
  production binding was used, and no cookie value was written to the
  repository.
- **Authenticated navigation:** `/api/auth/me` returned the expected staging
  identity. The following returned HTTP 200 with populated SSR shells or
  content: `/dashboard`, `/profile/edit`, `/create`, `/create/novel`,
  `/create/comic`, `/create/video`, `/work/3/edit`, `/work/3/novel`,
  `/work/6/comic`, `/comic/episode/2/edit`, `/chapter/2/edit`,
  `/work/3/chapter/new`, `/work/6/comic/episode/new`, and
  `/comic/episode/2/read?preview=1`. Missing/unowned targets
  `/chapter/99999/edit`, `/comic/episode/99999/edit`, `/work/99999/edit`,
  `/work/5/edit`, `/work/5/comic`, and `/api/studio/works/5` all returned 404.
- **SSR header check:** on protected pages the signed-in header rendered
  `Dashboard` / `Log Out`; an anonymous `/login` rendered `Log In` / `Join
  Free`. The footer's `Join Free` / `Log In` links are also present for
  signed-in users in Flask's `base.html:64-65`, so that text alone is not an
  anonymous-header defect. Public pages initially exposed a real defect (see
  the next bullet).
- **Connected data reads:** `/api/dashboard` returned `writable:true` and the
  existing works for user 4; `/api/studio/profile`,
  `/api/studio/works/3`, `/api/studio/works/3/novel`, `/api/comic/works/6`,
  and `/api/comic/episodes/2` returned the genuine WARDEN and The Lovers
  records, including all 9 comic pages.
- **Authenticated form-submission probes:** with a fresh `/api/auth/csrf`
  cookie and exact `Origin`, every invalid submit was rejected before any
  write. Status/message pairs were: profile blank username `400 Username must
  be at least 3 characters.`; profile blank display name `400 Display name
  cannot be empty.`; work blank title `400 Title cannot be empty.`; chapter
  blank title `400 Chapter title cannot be empty.`; new chapter blank title
  `400 Please give the chapter a title.`; episode blank title `400 Episode
  title cannot be empty.`; new episode blank title `400 Please give the
  episode a title.`; blank comment `400 Comment cannot be empty.` All eight
  messages match the Flask sources exactly (`lantern_profiles.py:67,80`,
  `lantern_works.py:271`, `lantern_chapters.py:123,276`,
  `lantern_comic_episodes.py:61`, `lantern_comic_editor.py:84`,
  `lantern_work_discussions.py:113`).
- **CSRF/auth negative probes:** missing token and token/cookie mismatch each
  returned `403 CSRF token missing or invalid.`; mismatched `Origin` returned
  `403 Cross-origin request rejected.`; studio API access without a session
  returned `401 Please log in to continue.`
- **Logout journey:** `POST /api/auth/logout` returned
  `{"ok":true,"message":"You have been logged out."}` and a session-clearing
  `Set-Cookie`; `/api/auth/me` then returned `{"user":null}` and
  `/dashboard` returned the real 302 to `/login?reason=login-required`.
- **Integrity after probes:** profile, work 3, chapter 2, episode 2, and the
  public staging catalog were re-read and were unchanged; the catalog still
  contains only works 3 and 6. No valid content mutation, upload, publication,
  deletion, test account, or synthetic work was performed.
- **Video limitation:** the dashboard contains no existing Video work, so the
  video uploader/publish journey could not be exercised live without creating
  synthetic content. `/create/video` renders correctly; the uploader and
  publication handlers remain covered by source and handler tests only.
- **Confirmed SSR defect — fixed:** a signed-in session on public pages
  (`/discover`, `/comics/6`, `/comic/episode/2/read`, `/login`, `/works/3`, and
  the public profile) rendered the anonymous header. Wrangler dev logs showed
  `NUXT_E1001`: `useRequestEvent()` was called after `await Promise.all(...)`
  in both `app/composables/useLanternAuth.ts` and `app/middleware/auth.ts`,
  so Nuxt had lost the request instance and the SSR identity lookup silently
  fell back to `null`. Both call sites now capture the event before the first
  await; `tests/auth-middleware-session.test.ts` asserts that ordering. After
  rebuild, all seven signed-in public routes above render `Dashboard` / `Log
  Out`, anonymous `/login` still renders `Log In` / `Join Free`, and no
  `NUXT_E1001` appears in the dev log.
- **Result:** one confirmed defect from this pass was fixed and deployed.
  Rehearsal smoke is 9/9; live probes returned 200 with no `NUXT_E1001` marker
  for `/`, `/discover?source=staging`, `/works/3?source=staging`,
  `/comics/6?source=staging`, `/comic/episode/2/read?source=staging`, the
  account entry pages, and both invalid token pages. `/api/public/config` still
  returns `{"defaultDatabase":"staging"}` and the public catalog still contains
  only works 3 and 6. Current rehearsal Version ID:
  `b6b99a45-6458-48af-97cb-218c0195bf44`.

---

## 2026-11-22 — Published-work media restoration (final results)

All four original published works and their complete media were restored into
isolated Nuxt staging. Scope: staging D1 (`lantern-staging-db`) and staging R2
(`lantern-staging-media`) only, via `wrangler.rehearsal.jsonc`. No production
access, no private/admin APIs, no application-code changes, no redeploy, no
deletes, and no commits. Full evidence is in
`docs/public-catalog-20261122/FINAL_RESTORATION_REPORT.md`.

### Restored content (original IDs preserved)

| Work | Title | Chapters | Episodes | Pages | Media objects | Status |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 6 | The Lovers (comic) | 0 | 22 | 610 | 611 | published |
| 9 | WARDEN: Legacy of Frost (comic) | 0 | 28 | 955 | 956 | published |
| 10 | The Lovers - Chapter 1 (Audio Book) | 0 | 0 | 0 | 2 | published |
| 11 | WARDEN: Legacy of Frost (novel) | 3 | 0 | 0 | 1 | published |

- Episode IDs preserved: work 6 = 1–11 and 13–23; work 9 = 24–51.
- Work 11 chapters 3/4/5 preserved with original ordering and byte-exact raw
  article content.
- Work 10 video and all covers preserved at original media keys.

### Media verification

- Downloaded from the original public site: **1,570 files / 4,994,792,440 bytes**,
  all with local SHA-256.
- Uploaded to staging R2: **958 objects** for works 9/10 and **612 objects** for
  works 6/11 = **1,570 / 1,570**; one transient 401 and one transient 401 upload
  failure were retried successfully.
- The 748 MiB audiobook exceeded Wrangler CLI's 300 MiB single-object limit and
  was uploaded with a 38-part R2 multipart upload through a temporary local
  `wrangler dev --remote` helper (not deployed). Final object:
  **784,755,576 bytes**, SHA-256
  `0fc4401a7e0b007f8d85eba81ee0f3776daa7578ba3b1cfa2efff0f3d9dd1158`.
- Remote SHA-256 verification: **958/958** (9/10) and **612/612** (6/11),
  **1,570 total**, **0 hash mismatches**, **0 missing**. The large video was
  verified by complete streaming retrieval and byte-by-byte hashing.
- Public HEAD status check: **1,570 / 1,570** objects present.
- Note: the public Worker media route intermittently returned HTTP 500 during
  bulk verification because the account hit D1's free-tier daily row-read limit
  (that route queries D1 to authorize public media; it resets at midnight UTC).
  Verification therefore used direct `wrangler r2 object get --remote`, which
  reads the exact staged R2 bytes. A 78/78 public probe passed before the limit
  was reached, covering all four works, covers, reader pages, and video byte-range
  delivery.

### Working staging URLs

- Work 6: `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev/comics/6?source=staging`
- Work 9: `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev/comics/9?source=staging`
- Work 10: `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev/works/10?source=staging`
- Work 11: `https://lantern-nuxt-rehearsal.midnightcaravans.workers.dev/works/11?source=staging`

### Conflict preservation and backup

- Conflicting staging rows were moved to preserved non-public drafts; **0 deletes**.
- Pre-reconciliation D1 backup:
  `docs/public-catalog-20261122/backups/staging-d1-before-reconciliation-20261122.sql`,
  SHA-256 `46793334de60e581076a07145d2ca42ff9c3be8eb45244736773c26dfbe35b5f`.

### Remaining difference

- **BEHAVIORAL DIFFERENCE — published-work display order:** the original creator
  profile lists works 10, 11, 9, 6; staging lists 9, 10, 11, 6 because
  `server/api/public/works.get.ts` sorts by `updated_at` and exact original
  timestamps are not exposed by the public source. Work identity, content,
  URLs, media, and publication status are restored; no timestamps were invented.

---

## 2026-11-22 — Final post-restoration public verification

Verification-only pass; no D1/R2 writes, no migration, no code changes, no
redeploy, no commits. Full evidence:
`docs/public-catalog-20261122/POST_RESTORATION_PUBLIC_VERIFICATION.md`.

- **D1 quota not reset:** at 07:11–07:20 UTC on 2026-11-22 the staging account
  was still over D1's free-tier daily row-read limit (confirmed by
  `wrangler tail`). The bulk verification consumed today's allowance; next
  reset is 00:00 UTC on 2026-11-23. The task premise that it had reset is
  therefore incorrect.
- **Public delivery currently degraded by that quota:** all 57 work-detail,
  comic-reader and chapter-reader HTML URLs return HTTP 200 but embed a
  `NuxtError` from an API 500, so they do not render content. The five public
  API checks and all attempted media (covers, page images, audiobook ranges)
  return HTTP 500. Low-concurrency verification stopped at the first 500 per
  category: 0 hard failures from the verifier, 57 degraded, 14 blocked.
- **Pre-exhaustion evidence remains valid:** `final-public-probe.json` recorded
  78/78 passed (detail APIs, 50 reader pages, covers, first-page images, video
  `206` range). Direct R2 SHA-256 verification covers 1,570/1,570 objects with
  0 mismatches and 0 missing; the full 784,755,576-byte audiobook hash matched.
  The blocker is infrastructure quota, not missing or damaged data.
- **Four published works confirmed:** a cached home render captured at 07:13
  UTC shows exactly works 9, 10, 11, 6, all published with correct covers and
  video path (`live-catalog-payload.json`). That cache has since expired.
- **Ordering difference retained:** no public evidence exposes original
  timestamps (no meta dates, JSON-LD, Last-Modified, or timestamp API across
  all 65 captured original responses). Reproducing `10, 11, 9, 6` would require
  inventing timestamps or guessing a sort rule, so no change was made.
- **Artifacts preserved:** D1 backup SHA-256
  `46793334de60e581076a07145d2ca42ff9c3be8eb45244736773c26dfbe35b5f`, media
  manifest, all verification reports. A sequential re-verification script
  (`scripts/final-public-delivery-verification.mjs`) is ready for after the
  quota resets.
