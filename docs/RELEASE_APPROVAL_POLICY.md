# Lantern release approval policy — single owner

**Status, 2026-11-27:** policy approved and the pinned Phase A candidate subsequently approved by the sole Application Owner; production writes remain disabled.
**Scope:** G3 explicit sign-off for the pinned Phase A Nuxt candidate only.
**Applies to:** `docs/release-gates.json`, `docs/release-signoff.template.json`, `scripts/release-gate-core.mjs`, and `scripts/release-gate.mjs`.

## Owner-approved model

The project owner is the **sole human approver**. The `applicationOwner` role
alone is accepted. The owner accepts responsibility for the combined
application, infrastructure, security, and operational decision.

This is a deliberate replacement of the earlier four-role model. The former
`infraCloudflare`, `authSecurity`, and `releaseManager` roles are not accepted
under this policy. Their presence in a sign-off is rejected rather than silently
ignored.

No independent human review is claimed. The owner acknowledgement must state:

- `noIndependentHumanReview: true`
- `acceptsInfrastructureAndSecurityRisk: true`

Approval must also contain a real owner name, a valid ISO date (`YYYY-MM-DD`),
and `approved: true`. No name, date, approval, or acknowledgment is invented by
the implementation or documentation.

## Immutable release-commit binding

The release gate state pins the exact source commit used to build and upload the
currently active Phase A production Nuxt candidate:

```text
f62b0abada1ee5b3ba1b0397ae9bfead1245e9de
```

This is a full 40-character lowercase hexadecimal SHA stored as `sourceCommit`
in `docs/release-gates.json`, together with:

```json
"approvalModel": "single-owner"
```

`npm run release:check` evaluates this immutable pin. It must **not** replace
the pin with `git rev-parse HEAD` or any other later Git HEAD. Documentation-only
and policy commits therefore do not invalidate approval of the already built
artifact.

A new application or build candidate requires a new full source-commit pin and
a new `applicationOwner` approval. An existing approval does not carry over to a
different artifact.

## Validator requirements

`evaluateReleaseGates` remains fail-closed and requires:

- existing G0–G3 gate and blocker checks remain unchanged in purpose;
- `approvalModel === 'single-owner'` in both gate state and sign-off;
- a full 40-character lowercase hexadecimal `sourceCommit`;
- `signoff.commit` exactly equal to the pinned `sourceCommit`;
- only the `applicationOwner` role, with `approved === true`;
- a non-empty owner name;
- a valid ISO `YYYY-MM-DD` date;
- both `noIndependentHumanReview === true` and
  `acceptsInfrastructureAndSecurityRisk === true`;
- rejection of unsupported legacy roles.

## Sign-off is not deployment authority

G3 approval records acceptance of the pinned release decision only. It does
**not**:

- enable `LANTERN_ENABLE_PRODUCTION_WRITES`;
- make `npm run deploy` executable;
- authorize D1, R2, DNS, route, domain, trigger, secret, or Worker changes;
- independently authorize further production operations;
- merge or publish a pull request;
- create a new release without a fresh commit pin and approval.

`docs/release-signoff.json` is deliberately absent at this policy change. The
template keeps approval and both acknowledgements false until the real owner
supplies them.

## Dated policy note — 2026-11-27

Earlier dated records describe the four-role model as it stood at the time.
They are preserved as historical snapshots. From this policy note forward, G3
uses the single-owner model and the immutable candidate pin above. The owner's
approval of this policy is not final release approval.


## Final pinned-candidate owner approval — 2026-11-27

The project owner, Christian Tarigan, recorded the final single-owner approval
for the Phase A candidate in `docs/release-signoff.json` on 2026-11-27. The
approval is bound to `f62b0abada1ee5b3ba1b0397ae9bfead1245e9de`. The owner explicitly acknowledged that
no independent human review was performed and accepted responsibility for the
combined infrastructure and security risk. The machine-readable G3 gate is
passing for this pinned candidate.

This approval does not enable production writes, make `npm run deploy`
executable, or authorize additional production operations. Any new application
or build candidate requires a fresh sourceCommit pin and owner approval.
