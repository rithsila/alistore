# npm audit — accepted exceptions

This file records deliberate decisions to accept specific `npm audit` findings in `backend/`.
Each entry is an advisory we have reviewed and chosen **not** to "fix," with the reasoning and a
re-review trigger.

> **Rule of thumb:** never run `npm audit fix --force` in this repo. It rewrites pinned
> `@medusajs/*` versions and breaks the locked stack. Resolve advisories via an upstream Medusa
> bump (see `.claude/rules/Stack.md`) or a *tested* pin-preserving `overrides` entry — never a forced fix.

---

## 2026-05-31 — `uuid <11.1.1` transitive chain (Medusa 2.15.3 fresh install)

**Status:** Accepted — known noise, not exploitable in our runtime.
**Audit at time of decision:** 81 findings (10 moderate, 71 high). Both the full tree and
`npm audit --omit=dev` report the same 81, i.e. these sit in the runtime tree, not dev-only.
(The `npm install` summary line counted them as 61 moderate / 20 high; the canonical
`npm audit` numbers above are authoritative.)

### The advisory
- **`uuid <11.1.1`** — [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) — severity **moderate**.
- "Missing buffer bounds check in v3/v5/v6 when `buf` is provided."

### Why the count inflates to 71 "high"
A single **moderate** `uuid` advisory propagates through Medusa's own dependency chain, and npm
re-marks every dependent "high":
- `@medusajs/telemetry` → uuid
- `bullmq` (Redis job queue) → uuid
- `@graphql-codegen/*` → uuid

### Why we accept it
The flaw only triggers when calling `uuid.v3() / v5() / v6()` with a caller-supplied output
**buffer**. Medusa and bullmq generate IDs with **v4 (random)** and never pass a buffer, so the
vulnerable code path is unreachable in our usage. No runtime exposure.

### Why we do NOT fix it
`npm audit` offers a fix only via `npm audit fix --force`, which **downgrades
`@medusajs/draft-order` 2.15.3 → 2.10.3** — a breaking change that:
- violates the exact-pin rule (`.claude/rules/Stack.md`),
- re-enters the post-v2.13.6 migration-bug window we deliberately pin above, and
- loses MFA-capability guarantees.

There is no in-range patch (the only patched `uuid` is `>=11.1.1`, a 2-major jump), so plain
`npm audit fix` does nothing here either.

### Sanctioned resolution
Wait for a deliberate Medusa bump (`Stack.md`: *"Medusa core pinned at 2.15.3 until a deliberate
bump"*) whose updated transitive `uuid` clears the advisory. A tested
`overrides: { "uuid": ">=11.1.1" }` is a fallback only, and risks breaking `bullmq`/`telemetry` —
verify before use.

### CI handling
Our rule is *"`npm audit --production` fail on `high`+"*. Allowlist **GHSA-w5hq-g745-h8pq** in the
audit gate (e.g. `audit-ci` / `better-npm-audit` allowlist) so this reviewed advisory does not fail
every build. Do **not** lower the global severity threshold.

### Re-review trigger
Re-run `npm audit` and update this entry **on any `@medusajs/*` version bump**. Remove the
exception once the upstream tree no longer pulls `uuid <11.1.1`.
