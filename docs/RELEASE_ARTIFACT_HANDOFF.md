# Release artifact handoff — local verification to manual Wrangler deploy

**Status:** preparation only. This document does not authorize a deployment and does not create a production-capable deploy command. `npm run deploy` remains fail-closed.

## 1. Two revisions, one artifact

The release has two independent Git identities:

| Identity | Meaning | Where it is read |
|---|---|---|
| Release-control SHA | The checked-out revision containing `docs/release-gates.json`, `docs/release-signoff.template.json`, and, when genuine, `docs/release-signoff.json` | `npm run release:check`, `npm run release:preflight`, and the release-build workflow checkout |
| Application source SHA | The approved full 40-character commit to compile | `docs/release-gates.json#sourceCommit`, `docs/release-signoff.json#commit`, and `sourceRef` |

The workflow event SHA (`github.sha`) is a third, informational value. It is not substituted for either identity. Sign-off and control records may be committed after the candidate because they live in the control revision; the build itself uses a detached worktree at `sourceCommit`.

`sourceRef` must be an immutable `refs/tags/...` ref resolving exactly to `sourceCommit`.

## 2. How the artifact is bound

`npm run release:build`:

1. Reads the approved controls from the release-control checkout.
2. Requires `sourceCommit` and `sourceRef` to be present, well formed, and mutually consistent.
3. Creates a detached worktree at exactly `sourceCommit` and verifies that worktree is clean and detached.
4. Runs `npm ci` and `npm run verify` once in that worktree. `npm run verify` already performs the Nuxt build.
5. Hashes every file in `.output`, excluding `release-manifest.json` itself, using a deterministic path/length/SHA-256 canonical form.
6. Writes `.output/release-manifest.json` and an identical control copy at `docs/release-artifact.json`.
7. Recomputes the copied artifact hash and refuses success if any file changed.

The manifest records `sourceCommit`, `sourceRef`, tag object/kind, source-tree hash, artifact hash, build ID, install/verify commands, workflow control SHA, workflow event SHA, and application source SHA.

## 3. Exact handoff sequence

Only after a genuine candidate, immutable ref, evidence, four distinct approvals, and all gates/blockers are ready:

1. Run `npm run release:build` from the approved release-control checkout. Do not use a checkout at the application source commit for this step.
2. Retain `.output/` and `docs/release-artifact.json` together. Do not edit either one.
3. Run `npm run release:preflight` immediately before the separately authorized deployment.
4. Record the `LANTERN_RELEASE_PREFLIGHT_OK source=... artifact=... build=...` line and the control SHA in the window ticket.
5. With separate explicit owner authorization, an operator runs the approved manual Wrangler command using `wrangler.release.jsonc`.
6. After deployment, record the reported Worker version next to the preflight artifact hash.

`wrangler.release.jsonc` must continue to point `main` at `./.output/server/index.mjs` and `assets.directory` at `./.output/public/`. The approved A1 production config also requires the `LANTERN_MEDIA_ORIGIN` Service Binding to the private `lantern-media` Worker; direct R2 access is not a substitute for that media architecture.

No rebuild, `npm run build`, `npm run verify`, formatter, generation step, or manual edit may touch the verified `.output` between preflight and deployment. If any delay, interruption, or uncertainty occurs, run `npm run release:preflight` again and record the new result.

## 4. What preflight proves

`npm run release:preflight` fails closed when it detects:

- a missing release state, sign-off, control manifest, or artifact manifest;
- an uncommitted or untracked control file;
- a short, malformed, or mismatched source SHA/ref;
- a tag that does not resolve to the approved source commit;
- an absent or malformed artifact directory;
- an artifact file changed or added after the build;
- a mismatch between the control manifest and the artifact manifest;
- a manifest whose `sourceCommit`, `sourceRef`, `sourceTreeHash`, `artifactDirectory`, or `artifactHash` does not match the approved state and the recomputed artifact;
- a production config that does not match the approved A1 Worker name, workers.dev hostname, Service Binding, production D1/R2 bindings, artifact paths, or media Worker isolation.

Tests cover missing artifacts, modified artifacts, mismatched manifests, wrong source SHA, wrong artifact directory, uncommitted controls, and production-write enablement. A successful preflight followed by a later artifact modification is detected by rerunning preflight.

## 5. Limits of the manual handoff

Preflight verifies the local filesystem at the moment it runs. It cannot prove that a later manual `wrangler deploy` used that exact `.output`, that nobody modified the artifact after the final check, or that the remotely deployed Worker version corresponds to the recorded hash. No production deploy wrapper is implemented in this phase, and no deployment is performed by the release scripts or workflow.

These are procedural limits, not claims of proven remote provenance. The operator must preserve the verified directory, use the approved config, and record the preflight hash and deployed version together. A remote Worker-version check remains a separate owner-authorized verification step.
