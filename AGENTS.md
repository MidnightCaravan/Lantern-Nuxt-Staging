# LANTERN — PROJECT BIBLE
## Permanent Project Instructions for OpenCode

Version: 1.0
Project: Lantern
Workspace: lantern-nuxt-staging
Mission: Faithful Flask-to-Nuxt Migration

---

# 1. PROJECT IDENTITY

Lantern is an application for creating, managing, publishing,
discovering, and consuming written and illustrated works.

The observed application includes:

- User registration and authentication.
- User profiles and creator dashboards.
- Novel and chapter management.
- Comic and episode management.
- Comic pages and media.
- Work discovery and public presentation.
- Comments and discussions.
- Video and media uploads.
- Email verification and password recovery.

This is a working description derived from the existing application
structure. The original Flask implementation defines the actual
features and behavior.

Do not invent additional product objectives.

# 2. THE MISSION

The mission is to migrate the existing Lantern application from
Python Flask to Nuxt.

The migration must reproduce the original application faithfully.

This is a ONE-TO-ONE MIGRATION.

The original Flask application is the behavioral source of truth.

The Nuxt implementation must preserve:

- Existing functionality.
- Existing user workflows.
- Existing UI and presentation.
- Existing business logic.
- Existing content behavior.
- Existing authentication and permissions.
- Existing validation rules.
- Existing data relationships and semantics.
- Existing error handling.
- Existing redirects and response behavior.

The objective is functional equivalence, not architectural
experimentation or product redesign.

A modern framework does not justify changing original behavior.

# 3. ABSOLUTE PROJECT RULE

DO NOT DECIDE WHAT LANTERN SHOULD BECOME.

The project owner defines the objectives.

OpenCode implements approved objectives.

You may discover bugs, gaps, risks, architectural problems,
and opportunities during investigation.

However, discovering something does not authorize you to fix it.

Repository TODOs, commit messages, technical documentation,
migration suggestions, and speculative architectural improvements
are information, not work assignments.

When the objective is ambiguous, stop and ask.

Never silently expand the scope of an assignment.

# 4. SOURCE OF TRUTH

Different evidence has different authority.

For product direction and project scope:
1. Explicit instructions from the project owner.
2. Previously approved project requirements.

For original application behavior:
1. Original Flask source code.
2. Original Flask templates, frontend assets, and workflows.
3. Original data structures, business rules, and configuration.
4. Verified original runtime behavior, where safely available.

For the migration:
5. Existing approved migration specifications.
6. Existing parity documentation and route mappings.
7. Current Nuxt implementation.
8. Existing automated tests and test reports.

Important:

A migration route map does not prove semantic parity.

A passing test suite does not prove complete feature parity.

An existing Nuxt implementation is not automatically correct.

If Nuxt behavior conflicts with verified original Flask behavior,
record the discrepancy and preserve the original behavior as the
migration target.

Do not fabricate missing requirements.

# 5. TECHNICAL ARCHITECTURE

The current migration uses:

Frontend:
- Nuxt
- Vue
- TypeScript
- CSS

Backend:
- Nuxt server routes
- Nitro
- Server-side application utilities

Infrastructure:
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Wrangler

Testing:
- Vitest

Major directories:

app/
  Client application, pages, components, middleware,
  composables, and layouts.

server/
  API endpoints, server routes, and server utilities.

public/
  Static assets.

migrations/
  SQL schema and migration reference files.

tests/
  Automated tests and test helpers.

docs/
  Migration documentation, route maps, and parity records.

scripts/
  Build, validation, migration, and deployment tooling.

.opencode/
  Project-specific AI agents and skills.

Versions and architecture details must be verified against
the current repository files before making implementation decisions.

Do not assume historical documentation reflects the current tree.

# 6. ORIGINAL FLASK REFERENCE

The repository has previously contained:

LANTERN_PARITY_SOURCE_BUNDLE_20261118-011830/
  Original Flask source snapshot.

LANTERN_MIGRATION_AUDIT_20261118-002806/
  Migration inventory and parity evidence.

Important documentation has included:

docs/PARITY_HARNESS.md
docs/parity-route-map.json
docs/LANTERN_FULL_MIGRATION_BATCH_V1.json

These are reference materials.

Verify their current availability before relying on them.

Treat the original Flask source bundle as a reference copy,
not an editable development target.

Never assume a candidate Flask-to-Nuxt mapping is correct
without inspecting both implementations.

# 7. MIGRATION REQUIREMENTS

Every migration audit and implementation must consider:

## Routes and navigation
- URL equivalence.
- HTTP methods.
- Parameters and query strings.
- Redirect behavior.
- Authentication requirements.
- Error responses.

## Authentication and accounts
- Registration.
- Login and logout.
- Sessions.
- Email verification.
- Password recovery.
- Token generation and expiration.
- Rate limiting.
- Authorization and ownership.

## Database and business logic
- Schema and relationships.
- Query behavior.
- Validation.
- Transactions.
- Defaults and null values.
- Ordering and pagination.
- Insert, update, and deletion semantics.

## Novel and chapter workflows
- Creation and editing.
- Chapter numbering.
- Autosave.
- Draft and publishing behavior.
- Reading experience.

## Comic and episode workflows
- Episode creation and editing.
- Page ordering.
- Image management.
- Preview and reader behavior.
- Publishing behavior.

## Media and uploads
- Upload validation.
- Size restrictions.
- Multipart processing.
- Storage organization.
- R2 integration.
- Media access permissions.
- Delivery and deletion.

## Discussions and moderation
- Comments.
- Replies.
- Likes.
- Editing and deletion.
- Reporting.
- Ownership and permissions.

## Email
- Trigger conditions.
- Message content.
- Recipient selection.
- Verification workflows.
- Error handling.

No feature is considered migrated solely because a corresponding
Nuxt file or endpoint exists.

# 8. NON-NEGOTIABLE RESTRICTIONS

NEVER perform the following without explicit authorization:

- Redesign existing interfaces.
- Add new application features.
- Change existing business rules.
- Replace original workflows with different workflows.
- Remove existing functionality.
- Change authorization behavior.
- Perform unnecessary refactoring.
- Modify production databases.
- Run production migrations.
- Deploy to production.
- Modify production infrastructure.
- Commit or push Git changes.
- Discard or overwrite existing work.

The production environment is READ-ONLY.

Do not deploy merely because a deployment script exists.

Do not execute remote Wrangler operations without explicit approval.

Never expose secrets or credentials.

Do not inspect or print the contents of .env, .dev.vars,
private keys, tokens, or other credential files.

# 9. PROTECT EXISTING WORK

The staging repository may contain uncommitted changes,
untracked files, backups, and migration artifacts.

Treat ALL existing work as valuable.

Before any proposed modification:

1. Inspect the current Git status.
2. Identify the exact files affected.
3. Understand existing modifications.
4. Explain the intended changes.
5. Obtain authorization for the specific scope.

Never independently execute:

- git reset --hard
- git clean
- git checkout to discard changes
- git stash
- mass deletion
- mass file replacement

Do not clean up unrelated files.

Do not assume that untracked files are disposable.

Do not overwrite backup or reference material.

# 10. DEVELOPMENT PROTOCOL

Every non-trivial assignment follows this process.

PHASE A — UNDERSTAND

- Identify the requested objective.
- Identify acceptance criteria.
- Inspect relevant project instructions.
- Identify relevant original Flask evidence.
- Understand the current Nuxt implementation.

PHASE B — INVESTIGATE

- Trace the complete relevant workflow.
- Identify dependencies.
- Identify existing behavior.
- Identify discrepancies and risks.
- Cite actual source files and line numbers.

PHASE C — PLAN

Present:
- Objective.
- Scope.
- Relevant files.
- Proposed changes.
- Potential risks.
- Verification approach.

Do not expand the assignment.

PHASE D — AUTHORIZATION

Wait for explicit project-owner authorization before modifying
files or performing operations that have side effects.

Approval for one task does not authorize unrelated tasks.

PHASE E — IMPLEMENT

- Modify only approved files.
- Preserve existing functionality.
- Follow the established architecture.
- Avoid unrelated refactoring.
- Keep changes minimal and traceable.

PHASE F — VERIFY

Run only the authorized verification procedures.

Inspect relevant test results and build output.

Do not claim success without evidence.

PHASE G — REPORT

Explain:
- What changed.
- Which files changed.
- Why they changed.
- What was tested.
- Test results.
- Remaining issues.
- Anything that could not be verified.

# 11. AUDIT AND EVIDENCE STANDARDS

Every parity finding must distinguish:

VERIFIED PARITY
Equivalent behavior is supported by evidence.

CONFIRMED GAP
Evidence establishes missing functionality.

BEHAVIORAL DIFFERENCE
Both implementations exist but behave differently.

POTENTIAL RISK
A possible issue exists but needs further investigation.

UNABLE TO VERIFY
Available evidence is insufficient.

Every finding should identify:

- Feature or workflow.
- Original Flask source.
- Nuxt implementation.
- Relevant file paths.
- Line numbers where available.
- Observed behavior.
- Difference and impact.

Never invent source references or line numbers.

Never declare complete parity from partial inspection.

# 12. AI AGENT RESPONSIBILITIES

Each specialized agent must operate within its assigned
responsibilities and permissions.

Planning agents:
- Understand objectives.
- Investigate.
- Propose implementation plans.
- Do not independently implement work.

Read-only auditors:
- Inspect and compare implementations.
- Produce evidence-based findings.
- Never modify files.
- Never execute commands.

Development agents:
- Implement only explicitly approved tasks.
- Respect all project-wide restrictions.

QA agents:
- Verify specified functionality.
- Report actual test and regression results.
- Never silently modify application behavior.

If a named custom agent cannot be registered or launched:

STOP.

Report the configuration or registration problem.

Never silently substitute another agent and claim that
the intended specialist was used.

# 13. COMMUNICATION RULES

Be precise, evidence-based, and transparent.

Do not pretend to understand a requirement that has not
been established.

Do not invent objectives from repository context.

Do not conceal uncertainty.

Do not claim a feature is complete without verification.

When conflicting evidence appears, explain the conflict.

Ask the project owner when a decision is required.

The project owner makes final product and implementation decisions.

# 14. CURRENT PROJECT POSITION

Lantern is undergoing a Flask-to-Nuxt migration.

The current workspace is the staging migration project.

Existing migration reports, route inventories, implementation
files, tests, and repair scripts are available as investigation
materials.

However, historical test counts, route counts, and completion
claims must be reverified before being reported as current.

Existing route coverage must not be confused with behavioral parity.

The immediate strategic objective is to establish a reliable,
controlled development and auditing environment.

The next migration work must be explicitly assigned and approved.

No unrelated infrastructure project, deployment system,
database migration runner, or feature expansion is authorized
merely by its appearance in repository documentation.

---

# FINAL PRINCIPLE

Preserve Lantern.

Understand Lantern.

Reproduce Lantern faithfully.

Do not turn Lantern into a different product.

The project owner's instructions define the mission.
The original Flask application defines the behavior.
OpenCode is responsible for helping execute that mission.
