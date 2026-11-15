# Security and data-integrity fixes (PR)

This branch addresses the 2026-11-15 audit. **Do not deploy the backend before migrations have been applied.**

## Migration order

1. Back up the Neon database; deploy only after approval of the PR and successful CI.
2. Apply migrations on the production database via a **one-time** migration job before switching backend traffic: `python manage.py migrate --noinput`. This creates `accounts.AuthThrottleBucket` and SimpleJWT blacklist tables.
3. Deploy the backend commit, then the frontend commit. Revert any one-time migration build command. Verify login, refresh rotation, logout and `/api/ready/`.
4. Check Vercel runtime logs and user sign-in flows; keep the main deployment unchanged until verified.

## Fixed in code

- P1-01: stale refresh responses cannot recreate a logged-out session.
- P1-02: background workout and diary syncs are scoped to the owner and auth generation, checking before/after network operations.
- P1-03: rotating refresh tokens are blacklisted; authenticated `/api/auth/logout/` revokes a refresh token. Offline logout still cannot revoke a previously exposed token until online.
- P1-04: PostgreSQL-backed account/IP auth throttling shared across serverless instances. The per-IP supplemental limit uses the proxy address, so deploy additional Vercel edge/WAF protection where supported.
- P2-05: non-UUID POST IDs respond with 400.
- P2-06: rejected diary edits are visible as errors, excluded from sums, and can be discarded; deleting one removes stale rejected upserts.
- P2-07: ingredient changes that make saved recipes impossible are rejected and rolled back atomically.
- P2-09: Android automatic data backup disabled. Secure platform token storage remains a separate hardening task.
- P3-10: `/api/ready/` reports PostgreSQL availability (distinct from the liveness `/api/health/`).

## Not fixed automatically

- P2-08: dependency audit has 18 reported vulnerabilities (including 4 high) in earlier Vercel build. CI now reports production-only npm audit results, but dependency upgrades must be based on actual advisory output and verified tests. **Do not run `npm audit fix --force` blindly.**
- P3-11: coach-client collaboration is an unimplemented product feature, not a regression. Building it is outside a bug-fix PR.

Local Python compilation can run without dependencies, but full Django/Vitest tests require installed project dependencies and PostgreSQL. CI runs them on an isolated test DB, not the production Neon database.
