# POMAK — password recovery and email verification rollout

**Status:** backend/frontend implementation in draft PR; `ACCOUNT_EMAIL_ENABLED=False` by default. Do not enable production account email flows until a verified sender and Android compatible build are in place.

## Security behavior

- `POST /api/auth/password/reset/request/` publishes the **same durable QStash queue message** for every syntactically valid email, whether or not an account exists. No account lookup or SMTP delivery occurs in the public request. It returns identical HTTP 202/JSON on queue acceptance (503 for any queue outage). Requests are subject to PostgreSQL-backed IP and email throttling.
- QStash signs and asynchronously POSTs the message to `/api/internal/password-reset-email/`. The worker checks the signed JWT issuer, canonical target URL, expiry and exact body hash before looking up an account and sending SMTP. Unknown addresses get the same 204 worker response but do not receive email. Delivery failures return 503 to trigger QStash retries. QStash messages are deduplicated for ten minutes and their bodies redacted from queue API logs.
- An emailed `/lozinka/reset?uid=...&token=...` link expires after **30 minutes**. The token is Django's password-reset HMAC and cannot be reused once the password changes.
- `POST /api/auth/password/change/` requires current password and authenticated JWT. Changing/resetting passwords increments the user's `session_version`. **All old access and refresh JWTs** fail authentication; outstanding refresh tokens are also blacklisted. Users sign in again with the new password.
- New accounts created **after** enabling `ACCOUNT_EMAIL_ENABLED` must confirm their email address using a signed 24-hour link; protected API endpoints return 403 until verified. `/api/auth/me/`, `/api/auth/email/resend/`, logout and confirmation are available during verification. Existing accounts are not retroactively locked out.
- Unverified confirmation is single-use; after a successful confirmation the user has to reload to refresh `/auth/me/`.
- Password rules use Django's existing password validators. Token values never enter application logs intentionally.
- No new email or password is stored in frontend localStorage; Android refresh remains in the native secure store.
- The register endpoint **still distinguishes duplicate emails**; complete anti-enumeration requires the separate signup-by-email workflow in issue #17.

## Production configuration

Set the following variables on **pomak-api**, through Vercel encrypted environment variables, and on `pomak-web` only where noted. Never commit credentials.

| Variable | Scope | Guidance |
|---|---|---|
| `ACCOUNT_EMAIL_ENABLED` | API | `False` initially; explicitly set `True` only after Android/web checks |
| `ACCOUNT_EMAIL_BASE_URL` | API | Canonical HTTPS web origin (e.g. `https://pomak-web.vercel.app`) |
| `EMAIL_HOST` | API | SMTP hostname of the chosen transactional provider |
| `EMAIL_PORT` | API | Usually `587` |
| `EMAIL_USE_TLS` | API | `True` for SMTP STARTTLS |
| `EMAIL_TIMEOUT` | API | SMTP socket timeout in seconds; defaults to `10` |
| `EMAIL_HOST_USER` | API | Encrypted SMTP username/API key |
| `EMAIL_HOST_PASSWORD` | API | Encrypted SMTP password/API key |
| `DEFAULT_FROM_EMAIL` | API | Verified sender for the project domain |
| `ACCOUNT_EMAIL_WORKER_URL` | API | Canonical HTTPS API callback, e.g. `https://YOUR-API.vercel.app/api/internal/password-reset-email/`; must match signed QStash subject exactly |
| `QSTASH_TOKEN` | API | Encrypted QStash publish token; never expose in frontend |
| `QSTASH_CURRENT_SIGNING_KEY` | API | Encrypted current signing key from QStash |
| `QSTASH_NEXT_SIGNING_KEY` | API | Encrypted next signing key for rotation |
| `VITE_ACCOUNT_EMAIL_ENABLED` | Web / Android build | Set `true` after email service QA to show the forgotten-password link |
| `SECRET_KEY` | API | Existing stable encrypted Django secret, do not rotate casually |

When enabled outside DEBUG, startup refuses missing QStash credentials or invalid/missing HTTPS sender and worker URLs. Configure the QStash destination first and verify the signed callback and SMTP in staging. Disabling this flag does not undo the schema migration or password changes. **Never use Django's console email backend in production**.

## Staged QA before enabling

1. **Before merging the PR or deploying the new backend**, use a trusted one-off release runner with this PR's checked-out migration code and the correct production `DATABASE_URL` to run `python manage.py sqlmigrate accounts 0006`. Confirm both new columns have persistent PostgreSQL defaults (`0` and `false`) and **neither has `DROP DEFAULT`**. Take a recoverable DB backup. If you cannot run this separate pre-deploy schema step, DO NOT merge the PR.
2. Still while **the old backend is serving production traffic**, run `python manage.py migrate accounts 0006` exactly once from that trusted runner. This is a schema-only deployment, not a frontend/API deployment. Immediately verify that **old backend login, refresh, and registration** continue to work: it must be able to insert users without specifying the two new fields because PostgreSQL retains the defaults.
3. Only after the migration and old-code smoke pass, merge/deploy the new backend and frontend with `ACCOUNT_EMAIL_ENABLED=False`. Confirm new login/refresh, password-change session revocation, pre-existing accounts, and older Android APK compatibility. Verify no email is sent while disabled.
4. Configure transactional email DNS/sender (SPF, DKIM, DMARC) **and QStash**. Test webhook signing (including rotated keys), known/unknown email parity, queue outages and delivery retries, deduplication, deliverability including a second real mailbox, link TTL/one-time consumption and resend failures.
5. Test signup → unverified profile → blocked protected routes → verify link → app accessible on web **and** a fresh Android build. Test reset and password change across two devices: all old JWTs must fail.
6. Only after these checks, enable `ACCOUNT_EMAIL_ENABLED=True` on the API and `VITE_ACCOUNT_EMAIL_ENABLED=true` at frontend build time; monitor rate limiting, error rates and delivery timeouts. Plan rollback by setting email flag to False while preserving data and previous account access.

**Rollback:** The schema change is intentionally additive. If rolling back the application to the old code, retain the two columns and database defaults; do not reverse migration `0006` while the new app might still run. A `main` merge can trigger Vercel auto-deployment, so migration-first is a hard requirement, not an optional post-merge task.

## Operational limits

Reset-request SMTP is **not synchronous**: it uses a managed QStash queue for all valid addresses, so account existence cannot be inferred from SMTP timing. The QStash publish operation remains in the request and has a four-second timeout; queue failure returns 503 regardless of whether the email is registered. The worker is a separately signed API endpoint and never logs links or email addresses. A 202 response confirms queue acceptance only, not eventual SMTP delivery. QStash is a third-party service with its own quotas, costs, retention and data-processing obligations; review them before enabling. If the provider fails after signup, new users need the resend operation. Signup verification email is still sent synchronously on commit and should be tested for slow SMTP. This PR does not provision providers, run live inbox or Android staging tests, implement SMS recovery or legal/privacy pages.
