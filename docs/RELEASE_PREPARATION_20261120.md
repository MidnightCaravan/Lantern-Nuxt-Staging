# B1 / B7 / G3 preparation record — 2026-11-20

**Scope:** read-only Cloudflare queries and local configuration/documentation
preparation only. No deploy, no DNS/route change, no R2/D1 mutation, no
production data read or write, and no release approval was created or implied.
`npm run release:check` remains **NOT READY**.

---

## 1. B1 — production media binding

### Read-only evidence gathered

| Item | Finding | Source |
|---|---|---|
| Cloudflare login | OAuth token, `midnightcaravans@gmail.com` | `npx wrangler whoami` |
| Account | `Midnightcaravans@gmail.com's Account`, id `976a3a206836442db1102c6e5d7a0cf5` | `npx wrangler whoami` |
| R2 buckets | `lantern-media` (2026-10-01), `lantern-staging-media` (2026-11-14), `midnight-caravan-assets` (2026-09-15) | `npx wrangler r2 bucket list` |
| Production binding identity | Flask Worker binds bucket `lantern-media` as `lantern_media` | `/Users/christian/lantern/wrangler.jsonc:25-29` |
| D1 databases | `lantern-db` = `bf50e1be-81d7-4cd1-b082-8aa03a784860`; `lantern-staging-db` = `5ce6be03-45c1-465e-a461-20e40148404e` — both match the local configs | `npx wrangler d1 list`, `wrangler.jsonc` |
| Worker name availability | `lantern-nuxt` does not exist on the account (API 10007) | `npx wrangler deployments list --name lantern-nuxt --json` |
| Token scopes | `account (read)`, `workers (write)`, `workers_routes (write)`, `d1 (write)`, `zone (read)`, plus write scopes for other products. No DNS/zone write scope was listed. Bucket listing nevertheless succeeded. | `npx wrangler whoami` |

### Prepared locally

- `wrangler.release.jsonc` now contains the **verified** bucket name
  `lantern-media` and binding `lantern_media`, with the same D1 bindings as
  `wrangler.jsonc`. The Worker name is **proposed** as `lantern-nuxt` and must
  be confirmed by the release manager before any deploy.
- `tests/release-config.test.ts` pins the bucket name, binding order, absence
  of unresolved placeholders, the fact that no npm script references the
  template, and that `npm run deploy` still exits 1.
- A local `wrangler deploy --dry-run --config wrangler.release.jsonc --outdir
  <local temp dir>` was attempted but the execution harness rejected the
  command at the permission layer. No Wrangler deploy or dry-run was executed.
  The config was validated by local JSONC parsing and the test gate instead.
  This is a verification limitation, not a config failure.

### Remaining B1 work

1. **Confirm the release Worker name** (`lantern-nuxt` proposed). — owner / release manager decision.
2. **Deploy the release config** so the Worker actually has the `lantern_media`
   binding. Exact action, not executed:
   ```
   npx wrangler deploy --config wrangler.release.jsonc
   ```
   This creates/updates Worker `lantern-nuxt` with production D1 (`lantern_db`)
   and production R2 (`lantern_media`) bindings. It does **not** move traffic
   and does **not** change DNS/routes. Requires your explicit approval.
3. **Provision the three Worker secrets** for both `lantern-nuxt` and
   `lantern-nuxt-rehearsal` after their Workers exist. Full requirements,
   Dashboard steps, and non-executed Wrangler commands are in section 6 below.
   No secret value is recorded in this repository.
4. **Verify media reads and Range behavior** against a production-shaped
   bucket with read-only object gets once a known key is supplied. No object
   listing is available in Wrangler 4.162.0 (`wrangler r2 object` only supports
   get/put/delete).
5. **Close B1** in `docs/release-gates.json` with the deploy evidence, and
   update the B1 row in `docs/CUTOVER_READINESS.md`. Not done — the binding is
   only prepared, not deployed.

B5 still holds: the legacy Worker remains the production media origin for the
first cutover. Binding `lantern_media` does not change public media URLs.

---

## 2. B7 — route/DNS rollback rehearsal

### Read-only evidence gathered

- `docs/REHEARSAL_RECORD.md` records a **PASS** for the section 6 smoke
  rehearsal on a locally built, locally seeded Worker, and explicitly does not
  close the route/DNS portion of B7.
- `docs/ROLLBACK_REHEARSAL_CHECKLIST.md` requires a Nuxt Worker deployed to a
  staging Cloudflare account, a real `[zone/record]` to flip, a recorded
  `[worker version]`, a `[snapshot id]`, and a `[window ticket]`.
- Latest legacy `lantern` deployment observed (candidate rollback artifact,
  **not yet confirmed live**): deployment
  `472f489c-b597-44d8-87a6-f3b59b80adbb`, version
  `93be1fa1-8ac2-49c7-adf3-2682b3be8365`, created
  `2026-10-26T22:30:22.06084Z` (`npx wrangler deployments list --name lantern --json`).
- The current token has `zone (read)` and `workers_routes (write)`, but no
  zone/DNS write scope. A DNS edit cannot be performed with these credentials.
  A Workers-route change may be possible if the route is supplied in config,
  but no route is present in either current config. Neither was attempted.

### Remaining B7 work

- Resolve `[zone/record]`, confirm the live rollback version, record a
  `[snapshot id]` (rehearsal decision: **do not restore production D1**), and
  open a `[window ticket]`.
- Deploy Nuxt to a staging-shaped Worker and execute checklist steps 1–9,
  capturing before/after route values, smoke output, and propagation timing.
- Append results to `docs/REHEARSAL_RECORD.md`, set `B7.closed: true` with the
  ticket link, and update readiness sections 4–6.

All of that requires Cloudflare infrastructure access and an explicit change
approval. No route, DNS, Worker, or snapshot state was touched in this pass.

---

## 3. G3 — explicit sign-off

### Verified requirements

- `scripts/release-gate.mjs:8-18,37` sets the effective release commit from
  `git rev-parse --short HEAD` at check time, overriding the stale
  `sourceCommit` in `docs/release-gates.json`.
- `scripts/release-gate-core.mjs` requires all four roles to be `approved:
  true` and the sign-off commit to equal that HEAD: `applicationOwner`,
  `infraCloudflare`, `authSecurity`, `releaseManager`.
- `docs/release-signoff.template.json` is the fill-in form.

### Prepared locally

- No `docs/release-signoff.json` was created. Creating one with approvals
  would fabricate release authorization, which is prohibited.

### Remaining G3 work

- After the final commit, copy the template to `docs/release-signoff.json`,
  set `commit` to the then-current `git rev-parse --short HEAD`, and have each
  of the four responsible people record a genuine approval with name and date.
- Any further commit after signing invalidates the hash and requires an update.

---

## 4. Task ownership matrix

| Task | Can I do it now? | Approval / access required |
|---|---|---|
| Read-only Cloudflare inventory (`whoami`, `r2 bucket list`, `d1 list`, deployments) | **Done** | None beyond existing login |
| Verify bucket identity against Flask config | **Done** | None |
| Fill and locally test `wrangler.release.jsonc` | **Done** | Worker name confirmation before use |
| Wrangler deploy dry-run | **Blocked** by harness permission policy | Local policy, not Cloudflare |
| Deploy release Worker with `lantern_media` binding (B1) | **No — production change** | Your explicit approval after seeing exact command above; infra/release manager confirm Worker name |
| Define/confirm the three secret values for both Workers (B1) | **No — must come from owner/Brevo account** | Owner generates two distinct session secrets; owner supplies Brevo API key and verified sender address. No values may be sent to or stored by the agent. |
| Provision secrets via Dashboard or interactive Wrangler (B1) | **No — remote change** | Your explicit approval; exact read-only-verification commands in section 6 |
| Verify production-shaped media reads/Range | Partially — need a known object key | Infra to supply key; read-only gets only |
| Close B1 in gate files | **No — not actually bound yet** | Evidence from deploy |
| Confirm live rollback Worker version | Partially — candidate recorded | Infra confirmation |
| Resolve zone/record, snapshot id, window ticket (B7) | **No** | Infra + release manager |
| Route/DNS flip and revert rehearsal (B7) | **No** | Staging Cloudflare access, zone/DNS write credentials, explicit change approval |
| Record rehearsal results and close B7 | After rehearsal evidence exists | Ticket link from release manager |
| Create sign-off file with real approvals (G3) | **No** | Four named role holders; you must not let me fabricate them |
| Run `npm run release:check` after B1/B7/G3 | **Yes** | None |
| Deploy / cutover / DNS change | **No** | Separate explicit authorization after READY |

### Approvals that must come from other responsible people

- **Release manager:** release Worker name, window/ticket, rehearsal result acceptance.
- **Infra / Cloudflare:** zone/record, live rollback version, snapshot identifier,
  elevated zone/DNS write credentials if DNS (not Workers routes) is used.
- **Application owner:** final cutover approval and the B5 media-URL decision.
- **Auth / security:** sign-off on session/rate-limit/reset behavior.

---

## 5. Two-configuration preparation (same day)

### Configurations

| | `wrangler.release.jsonc` | `wrangler.rehearsal.jsonc` |
|---|---|---|
| Worker name | `lantern-nuxt` (proposed, confirm) | `lantern-nuxt-rehearsal` |
| workers.dev | **false** | **true** (safe separate test URL) |
| Routes / domains / triggers | none | none |
| D1 bindings | `lantern_db` → `lantern-db` (`bf50e1be…`); `lantern_staging_db` → `lantern-staging-db` (`5ce6be03…`) | `lantern_staging_db` only |
| R2 bindings | `lantern_media` → `lantern-media`; `lantern_staging_media` → `lantern-staging-media` | `lantern_staging_media` only |
| Production resource ids/binding names | present and verified | **absent** — asserted by tests |
| Deployed? | **No** | **No** |

The rehearsal config deliberately has no production bindings, so
`/api/public/health`, `/api/public/works` and `/media/*` return 503 there by
design. `scripts/rehearsal-smoke-check.mjs` treats those as expected results.
The full production-shaped smoke run remains the locally seeded rehearsal in
`docs/REHEARSAL_RECORD.md`. Application writes still target staging bindings
in both configs.

### Local validation performed

- `npx vitest run tests/environment-configs.test.ts tests/release-config.test.ts` → 6 passed.
  Tests prove: rehearsal contains no production id/name/binding, production
  keeps the verified bindings, `workers_dev` differs correctly, neither config
  declares routes/domains/triggers, neither is wired into npm scripts, and the
  deploy guard still exits 1.
- `npx wrangler dev --config wrangler.rehearsal.jsonc --local --port 8891 --persist-to <temp>` → config loaded, `/login` 200, bindings shown as **local only** (staging D1/R2 + ASSETS).
- `npx wrangler dev --config wrangler.release.jsonc --local --port 8892 --persist-to <temp>` → config loaded, `/login` 200, all four bindings shown as **local only** (no production access).
- `npm run verify` → 48 routes, gap=0, 228 tests across 26 files, build green
  (includes the 64-test write-isolation suite committed at HEAD `1584590`).
- No `wrangler deploy`, no remote mode, no DNS/route change, no production read/write, no sign-off file.

Wrangler's local dev reported hidden environment-variable names
(`LANTERN_NUXT_SESSION_SECRET`, `LANTERN_BREVO_API_KEY`, `LANTERN_MAIL_FROM`)
supplied by local dev state. Values were not inspected or printed. These are
**not** part of either config and must be provisioned separately for any
deployed Worker.

### Exact commands

Local testing (safe, no remote access):
```
npx vitest run tests/environment-configs.test.ts tests/release-config.test.ts
npx wrangler dev --config wrangler.rehearsal.jsonc --local --port 8891 --persist-to <local temp dir>
node scripts/rehearsal-smoke-check.mjs http://127.0.0.1:8891
npx wrangler dev --config wrangler.release.jsonc --local --port 8892 --persist-to <local temp dir>
```

Proposed staging rehearsal (requires your approval before execution):
```
npx wrangler deploy --config wrangler.rehearsal.jsonc
# record the printed https://lantern-nuxt-rehearsal.<subdomain>.workers.dev URL
node scripts/rehearsal-smoke-check.mjs <that workers.dev URL>
# flip the staging [zone/record] to the rehearsal Worker, re-run the check,
# revert to [worker version], re-run the Flask-side checks, record evidence
```
No deploy command was executed. The production config must **not** be deployed
as part of the rehearsal.

### Remaining B7 permissions / information

- Staging Cloudflare account access and permission to create/deploy a Worker.
- `[zone/record]` to flip, confirmation of the live `[worker version]`, a
  `[snapshot id]`, and a `[window ticket]`.
- Zone/DNS write credentials (current token has `zone (read)` only), or an
  approved Workers-route configuration if a route is used instead.
- Provisioning of the three secret names listed above for the rehearsal Worker
  (see section 6; the rehearsal session secret must differ from the release one).
- Explicit approval for the rehearsal deploy and route flip/revert.

---

## 6. B1 Worker secrets — inventory and provisioning preparation

Evidence below was checked at HEAD `1584590`. No secret value was read,
generated by the agent, printed, or written to any file. Wrangler reported the
names as hidden environment variables during earlier local dev runs only.

### 6.1 Code references and purpose

| Secret | Code references | Purpose | Hard requirement |
|---|---|---|---|
| `LANTERN_NUXT_SESSION_SECRET` | `server/utils/lantern-auth.ts:34-41,138-139,156` (`getSessionSecret`, session create/verify HMAC-SHA-256), `server/utils/lantern-rate-limits.ts:93-99` (HMAC key for `auth_rate_limits` counter hashes), `server/api/auth/login.post.ts:30` (login fails closed with 503 if missing or shorter than 32 characters) | Signs and verifies the `lantern_nuxt_session` cookie and keys durable authentication rate-limit counters. | String of **at least 32 characters**; high-entropy random value. Must be **different for each Worker**: reusing one value would let a cookie minted by the rehearsal Worker validate on the release Worker and would share rate-limit key space across environments. Treat rotation as a session/rate-limit reset. |
| `LANTERN_BREVO_API_KEY` | `server/utils/lantern-auth.ts:210,249` (Brevo `https://api.brevo.com/v3/smtp/email` header `api-key`), `server/api/auth/forgot-password.post.ts:10,15` | Authenticates outbound verification, resend, and password-reset email through Brevo. | Must come from **your Brevo account**. Needs SMTP/transactional send permission. If absent, verification/resend return `emailSent: false`; forgot-password fails with 503/502. |
| `LANTERN_MAIL_FROM` | `server/utils/lantern-auth.ts:211,240` (sender fallback `LANTERN_MAIL_FROM \|\| MAIL_FROM`), `server/api/auth/forgot-password.post.ts:11` (same fallback, accepts `Name <email>`) | Sender address used in Brevo payloads. | Must come from **your Brevo configuration** and be a **verified sender** (or verified sending domain). Strong preference: set a **bare email address**, e.g. `<VERIFIED_SENDER_EMAIL>`. Reason: the verification/resend path (`lantern-auth.ts:240`) assigns the entire string to `sender.email` and sets the display name separately to `Lantern`; a `Name <email>` value would be sent as an invalid email address there. The forgot-password parser accepts either form, but the bare address works for both paths. `MAIL_FROM` is only a fallback alias; it is not needed if `LANTERN_MAIL_FROM` is set. |

Values requiring your Brevo account / verified sender: **`LANTERN_BREVO_API_KEY`**
and **`LANTERN_MAIL_FROM`**. The two session-secret values do not involve Brevo;
they can be generated locally by the owner.

`LANTERN_PUBLIC_BASE_URL` is a non-secret optional variable. It is not present
in either config; verification links fall back to the request origin. No change
is proposed here.

### 6.2 Required per Worker

| Worker | `LANTERN_NUXT_SESSION_SECRET` | `LANTERN_BREVO_API_KEY` | `LANTERN_MAIL_FROM` |
|---|---|---|---|
| `lantern-nuxt-rehearsal` (B7, staging-only bindings, `workers.dev` enabled) | **Required — rehearsal-unique value** | Required for full auth rehearsal; same Brevo key may be used if intended | Required for full auth rehearsal; same verified sender may be used if intended |
| `lantern-nuxt` (B1 release, off-route, production D1/R2 bindings) | **Required — release-unique value, different from rehearsal** | Required for production-shaped verification/reset flows; use the intended production Brevo key | Required; use the intended production verified sender |

Both Workers run the same application code, so the same **three variable names**
must exist on each. Only the session secret values must differ between them.
Whether Brevo credentials are shared or environment-specific is a decision for
the Brevo account owner; this record does not assume either.

### 6.3 Generate the session secrets without exposing them

On macOS, generate and copy each value to the clipboard without printing it:

```
openssl rand -base64 48 | pbcopy    # run once for rehearsal; paste into its Dashboard/secret prompt
openssl rand -base64 48 | pbcopy    # run again for release; paste into its Dashboard/secret prompt
```

Do not paste either generated value into chat, tickets, `.env`, `.dev.vars`,
scripts, tests, or Git. Do not reuse a value from local development state.

### 6.4 Exact Cloudflare Dashboard steps (preferred — values stay in the browser)

For **each** Worker (`lantern-nuxt-rehearsal` and `lantern-nuxt`):

1. Open Cloudflare Dashboard → **Workers & Pages** → select the Worker.
2. Go to **Settings → Variables and Secrets**.
3. Use the **Production** environment (the configs define no `[env.*]` block).
   Do not add these under a preview environment.
4. Select **Add variable** → choose the **Secret** type → enter the exact name
   `LANTERN_NUXT_SESSION_SECRET` → paste that Worker's unique generated value →
   save/deploy.
5. Repeat step 4 for `LANTERN_BREVO_API_KEY` and `LANTERN_MAIL_FROM`.
6. Confirm the three rows appear as masked secrets. Do not take or share
   screenshots while a value is visible.
7. Repeat all steps for the second Worker with its own distinct session secret.

### 6.5 Secure Wrangler commands — documented only, NOT executed

Wrangler 4.162.0 `secret put` supports `--config` and prompts interactively for
the value; it does not accept the value as a command-line argument. Run these
only after the corresponding Worker exists and only with your explicit
authorization:

```
# lantern-nuxt-rehearsal — paste the rehearsal-unique session secret at the prompt
npx wrangler secret put LANTERN_NUXT_SESSION_SECRET --config wrangler.rehearsal.jsonc
npx wrangler secret put LANTERN_BREVO_API_KEY --config wrangler.rehearsal.jsonc
npx wrangler secret put LANTERN_MAIL_FROM --config wrangler.rehearsal.jsonc

# lantern-nuxt — paste a different release-unique session secret at the prompt
npx wrangler secret put LANTERN_NUXT_SESSION_SECRET --config wrangler.release.jsonc
npx wrangler secret put LANTERN_BREVO_API_KEY --config wrangler.release.jsonc
npx wrangler secret put LANTERN_MAIL_FROM --config wrangler.release.jsonc
```

Rules for these commands:

- Paste at the interactive prompt. Never use `echo`, `printf`, shell arguments,
  here-documents, `--env-file`, or CI variables that could put a value in shell
  history, process listings, logs, or the repository.
- Do not run `wrangler secret put` with `--env` unless an `[env.*]` block is
  deliberately added to a config; neither current config has one.
- Recommended order: deploy/authorize the Worker first, then add secrets, then
  verify names, then run auth smoke flows.
- Name-only verification (remote but read-only; still requires your approval):

```
npx wrangler secret list --config wrangler.rehearsal.jsonc
npx wrangler secret list --config wrangler.release.jsonc
```

`secret list` reports names and types, not values. The expected result is the
three names above on each Worker.

### 6.6 Environment isolation reverified in this pass

- `npx vitest run tests/environment-configs.test.ts tests/release-config.test.ts`
  → **6 passed**. Rehearsal still has no production D1/R2 id, name, or binding
  name; release still binds verified `lantern_db` and `lantern_media`; neither
  config declares routes/domains/triggers or is wired into npm scripts; deploy
  guard still fails closed.
- `npx wrangler dev --config wrangler.rehearsal.jsonc --local --port 8891
  --persist-to <temp>` → `/login` 200; only `lantern_staging_db` and
  `lantern_staging_media` shown, both **local**.
- `npx wrangler dev --config wrangler.release.jsonc --local --port 8892
  --persist-to <temp>` → `/login` 200; `lantern_db`, `lantern_staging_db`,
  `lantern_staging_media`, and `lantern_media` all shown as **local**.
- `npm run release:check` still reports **NOT READY** (B1, B7, G3). No deploy,
  remote Wrangler command, DNS/route change, or Cloudflare mutation was run.

### 6.7 Remaining B1 requirements — what is needed from the owner

1. Confirm the release Worker name `lantern-nuxt`.
2. Generate and retain two distinct session secrets (rehearsal and release), ≥32
   characters each. Do not send them to the agent and do not store them in Git.
3. Confirm the intended Brevo API key and a **verified bare sender email** for
   each Worker (or confirm that the same Brevo credentials are intended for
   both).
4. Give explicit approval to deploy `wrangler.release.jsonc` (creates the
   `lantern_media` binding on `lantern-nuxt`) and, separately, to deploy the
   rehearsal Worker if B7 is to proceed.
5. Provision the three secrets through the Dashboard or the interactive
   commands in 6.5, then confirm the name-only `secret list` output.
6. Supply a known production media object key for read-only Range checks.
7. Only then close B1 in `docs/release-gates.json` and
   `docs/CUTOVER_READINESS.md` with the deploy and verification evidence.

**Ready now:** all code references, per-Worker requirements, Dashboard steps,
and non-executing Wrangler command text; both configs reverified and isolated.
**Blocked on you:** Worker-name confirmation, the three values per Worker,
explicit deploy/provisioning authorization, and a known media key.
