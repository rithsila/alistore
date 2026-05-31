# Supply-chain hardening policy

> Task: `SETUP-01B`. Scope: both repos (`backend/`, and `ali-store-storefront/`
> once scaffolded). Authoritative rules: `.claude/rules/Stack.md` and
> `.claude/rules/security.md` — this doc explains how they are enforced.

## Policy

1. **Exact version pins.** Every dependency in every `package.json` uses an exact
   version — no `^`, no `~`, no ranges. Enforced at write time by `.npmrc`
   (`save-exact=true`) so `npm install <pkg>` records an exact version.
2. **Commit lockfiles.** `package-lock.json` is committed and is the single
   source of truth for the installed tree.
3. **`npm ci` everywhere.** CI and servers install with `npm ci` (which fails if
   `package.json` and the lockfile disagree). Never `npm install` in CI or
   deploy paths — it can silently mutate the lockfile.
4. **Publish cooldown.** Do not bump to a version published in the last ~7–14
   days. New releases are the prime window for a compromised-package attack;
   let them age first. This applies doubly to anything on the backend/payment
   path.
5. **Audit gate in CI.** `npm audit` runs on every push/PR and fails the build on
   high/critical advisories that are not explicitly allowlisted (see below).
6. **Minimal dependencies.** Prefer the standard library / existing deps over new
   packages. No new dependency without explicit approval (`Stack.md`). Avoid
   packages with very low weekly downloads or no source history.
7. **Vendor security-critical logic.** Do not depend on `bakong-khqr` at runtime.
   Its QR/MD5 logic is reviewed and vendored into
   `backend/src/modules/bakong-payment/` (delivered by the payment-module task),
   so the payment path has no live third-party dependency. This file records the
   policy; the vendoring itself is implemented under the Bakong module task.
8. **Never `npm audit fix --force`.** It rewrites pinned `@medusajs/*` versions and
   breaks the locked stack. Resolve advisories via a deliberate Medusa bump or a
   tested, pin-preserving `overrides` entry (`docs/npm-audit-exceptions.md`).

## The CI audit gate (`ci/audit.yml`)

The workflow installs with `npm ci`, runs `npm audit --json`, and filters the
result with an inline Node script (no extra dependency). The build **fails** when
any high- or critical-severity advisory is present that is **not** in the
allowlist; allowlisted advisories are reported but do not block.

- **Allowlist** lives inline in `ci/audit.yml` as a list of GHSA ids. Every id in
  it MUST have a reviewed, justified entry in `docs/npm-audit-exceptions.md`.
- **Severity threshold** is high+ (`high`, `critical`). Do not lower this to make
  the build pass — allowlist a specific, reviewed advisory instead.
- A **newly introduced** high/critical advisory is not allowlisted, so it fails
  CI immediately. (Validated: with an empty allowlist the gate fails on the
  current high advisories; allowlisting a GHSA id removes only that advisory.)

### Activating the CI audit

GitHub Actions auto-discovers workflows only under `.github/workflows/`. The gate
is delivered at the task-specified path `ci/audit.yml`; enable it by referencing
it from `.github/workflows/audit.yml`:

```yaml
on: [push, pull_request]
jobs:
  audit:
    uses: ./ci/audit.yml
```

(For a non-GitHub runner, invoke the same steps from that provider's pipeline.)

## Current baseline — required triage

A fresh Medusa `2.15.3` install carries known advisories. As of 2026-05-31 a full
`npm audit` on `backend/` reports **71 high / 0 critical**. Only the `uuid` chain
(`GHSA-w5hq-g745-h8pq`) is currently documented in
`docs/npm-audit-exceptions.md` and allowlisted.

Validation surfaced **additional high-severity advisories not yet documented**
(e.g. `@mikro-orm/knex` `GHSA-cfw5-68c4-ffqp`,
`@opentelemetry/exporter-prometheus` `GHSA-q7rr-3cgh-j5r3`). Until each is
reviewed and either remediated or given a documented exception + allowlist entry,
the gate will (correctly) fail. **Do not blanket-allowlist them.** Triaging these
into `docs/npm-audit-exceptions.md` is follow-up security work, tracked separately
from `SETUP-01B`.

## Bumping a dependency

1. Confirm the target version is older than the cooldown window (~7–14 days).
2. Update the exact version in `package.json` and run `npm install` locally to
   refresh the lockfile (never `--force`).
3. Run `npm audit`; if a high/critical appears, fix it or open a reviewed
   exception — do not lower the threshold.
4. Commit `package.json` + `package-lock.json` together.
